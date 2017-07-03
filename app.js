var Map = (function(win,doc,undefined){

    //#GLOBAL VARIABLES
    var width = 0,                              //width of the map canvas
        height = 0,                             //height of the map canvas
        aspectRatio = 1,                        //for now we'll just force a square canvas
        mainContainer,                          //where does the canvas go?
        canvas = $('<canvas#map-canvas>'),      //where we'll be drawing everything
        ctx = canvas.getContext('2d'),          //how we'll draw it
        pixelsPerMeter = 0;                     //so we can scale to map tiles

    //#COLORS
    var colorPoint = '#7F6422',
        colorUI = '#7662BE';

    //#COMPONENT VARIABLES
    var coordinates = [],                       //zoom,x,y,radius,angle,latitude,longitude, minimum 3
        coordString = '',
        scale = 0,
        center = [0,0],
        mousePosition = [0,0];                  //current mouse position in canvas coordinates

    //##ZOOM BEHAVIOR
    var zoom = d3.behavior.zoom()
        .on('zoom',handleZoom);
    var zooming = false,
        lastScale = 0,
        lastZoomTarget = '';

    //##SCALES
    var planetRotation = d3.scale.linear()      //when we first see a planet, we see it from the north pole
            .range([-90,0])
            .clamp(true);
    var planetWarp = d3.scale.linear()          //as we zoom in, it unfolds from orthographic to mercator
            .range([0,1])
            .clamp(true);
    var albedoColor = d3.scale.linear()
            .domain([0,0.5])
            .range(['#555',colorPoint])
            .clamp(true);

    //##PROJECTIONS
    var projOrtho = d3.geo.orthographic()
        .scale(100)
        .translate([width / 2, height / 2])
        .clipAngle(90)
        .precision(1);
    var projMercator = d3.geo.mercator()
        .scale(25)
        .translate([width / 2, height / 2]);
    //we have to roll a custom projection to handle the unfolding
    var projTransition = interpolatedProjection(projOrtho,projMercator);
    function interpolatedProjection(a, b) {
        var projection = d3.geo.projection(raw).scale(1),
            center = projection.center,
            translate = projection.translate,
            α;

        function raw(λ, φ) {
            var pa = a([λ *= 180 / Math.PI, φ *= 180 / Math.PI]), pb = b([λ, φ]);
            return [(1 - α) * pa[0] + α * pb[0], (α - 1) * pa[1] - α * pb[1]];
        }

        projection.alpha = function(_) {
            if (!arguments.length) return α;
            α = +_;
            var ca = a.center(), cb = b.center(),
                ta = a.translate(), tb = b.translate();
            center([(1 - α) * ca[0] + α * cb[0], (1 - α) * ca[1] + α * cb[1]]);
            translate([(1 - α) * ta[0] + α * tb[0], (1 - α) * ta[1] + α * tb[1]]);
            projection.clipAngle(90+(90*α));
            return projection;
        };
        return projection.alpha(0);
    }
    
    //##MAPS
    var mapData,                                        //when we zoom in, we'll grab map info
        oldMapData,                                     //and keep two sets, just in case
        oldMapName = '';

    var path = d3.geo.path()                            //this is just all d3 boilerplate for maps
        .context(ctx);
    var graticule = d3.geo.graticule(),
        graticuleOutline = graticule.outline();
    graticule = graticule();

    //##LABELS
    var forceLabels = d3.layout.force()
            .gravity(0)
            .friction(0.6)
            .linkDistance(20)
            .linkStrength(0.5);
    var labelNodes = [],
        labelLinks = [];


    //##CLERICAL
    var viewMode = 1,                                   //system or planetmode
        visibleObjects = [],                            //how many distinct objects are visible on screen
        visiblePrimaries = [],                          //how many of them have satellites
        needsMove = true,                               //we won't handle movements unless we've zoomed
        highlightedObject = -1;

    //##DEBUGGING
    var fps = 0;

    //#INITIALIZATION
    function init(obj){
        //find the container
        //TODO: Make it and add to body if not found, issue warning?
        mainContainer = d3.select('#'+obj.container);
        if(mainContainer.empty()){
            console.error('Could not find container (#' + obj.container + ')');
            return;
        }
        //set the size of the canvas
        //TODO: custom aspect ratio
        var min = Math.min(win.innerWidth,win.innerHeight);
        width = min*aspectRatio;
        height = min;
        canvas.width = width;
        canvas.height = height;
        mainContainer.node().appendChild(canvas);
        planetRotation.domain([30,height/2]);   //these probably need tweaked
        planetWarp.domain([height/2,height]);

        //add event listeners
        mainContainer.call(zoom);
        mainContainer.on('click',handleClick);
        mainContainer.on('mousemove',handleMouseMove);
        win.addEventListener('resize',handleResize);

        //load data
        d3.json(obj.data,function(data){
            if(!data.settings || !data.bodies){
                console.error('Could not load '+ obj.data);
                return;
            }
            pixelsPerMeter = data.settings.pixelsPerMeter;
            scale = 0;
            data.bodies.forEach(function(d){
                var b = new Body(d);
                if(scale < b.linearEccentricity) scale = b.linearEccentricity;
            });
            scale = width/scale;
            bodies.forEach(function(d){
                if(d.satellites.length){
                    d.satellites = d.satellites.sort(function(a,b){ return a.majorAxis - b.majorAxis; });
                    d.pointMaxZoom = (height/4)/d.satellites[d.satellites.length-1].majorAxis;
                }
            });
            start();
        });
    }
    function start(){ 
        //set initial view
        //TODO: This has some precision problems, gets close but not really close enough
        center[0] = width/2;
        center[1] = height/2;
        if(location.hash && location.hash != ''){
            var t = location.hash.split('/');
            t.forEach(function(d,i){
                d = parseFloat(d.replace('#',''));
                coordinates[i] = d;
            });
            if(!coordinates.includes('NaN')){
                scale = Math.pow(2,coordinates[0])*pixelsPerMeter;
                center[0] = (coordinates[1]*scale);
                center[1] = (coordinates[2]*scale);
            }
        }
        zoom.scale(scale);
        zoom.translate(center);
        zoom.size([width,height]);
        win.requestAnimationFrame(loop); 
    }

    //#MAIN LOOP FUNCTIONS
    var oldTime = 0,
        dt = 0;
    function loop(time){
        win.requestAnimationFrame(loop);
        dt = (time-oldTime)/1000;
        oldTime = time;
        fps = 1/fps;

        tick(dt);

        if(needsMove) update();

        if(dt < 1) draw(ctx);
    }

    //fires every loop()
    function tick(dt){
        highlightedObject = -1;
        visibleObjects.forEach(function(d){ d.tick(dt); });
    }

    //fires every time the view changes probably from zoom()
    function update(){
        needsMove = false;
        visibleObjects.length = 0;
        bodies.forEach(function(d){ d.update(); });
        if(lastScale - scale > 0){
            //TODO: This should probably be based on buttons, not trying to intuit intent
            //zoomed out
            if(visibleObjects.length == 1){
                var z = Math.pow(2,visibleObjects[0].pointMinZoom+2)*pixelsPerMeter;
                if(z < scale){
                    if(!zooming) zoomTo(z,
                    [visibleObjects[0].x+visibleObjects[0].center.x,visibleObjects[0].y+visibleObjects[0].center.y]);
                }
            }
        }else if(lastScale - scale < 0){
            //zoomed in
            if(visibleObjects.length == 1 
                && lastZoomTarget != visibleObjects[0].name
                && visibleObjects[0].pointMaxZoom > scale){
                lastZoomTarget = visibleObjects[0].name;
                if(!zooming) zoomTo(visibleObjects[0].pointMaxZoom,
                    [visibleObjects[0].x+visibleObjects[0].center.x,visibleObjects[0].y+visibleObjects[0].center.y]);
            }
        }
        var t = visibleObjects.map(function(d){return d.name;});
        for(var i = 0; i < labelNodes.length;i++){
            if(i%2) continue;
            var j = t.indexOf(labelNodes[i].name);
            if(j >= 0){
                t.splice(j,1);
                labelNodes[i+1].px = bodiesByName[labelNodes[i].name].viewPoints[0][0];
                labelNodes[i+1].x = labelNodes[i+1].px;
                labelNodes[i+1].py = bodiesByName[labelNodes[i].name].viewPoints[0][1];
                labelNodes[i+1].y = labelNodes[i+1].py;
            }else{
                labelNodes.splice(i,2);
                i--;
            }
        }
        t.forEach(function(d,i){
            labelNodes.push({name:d});
            labelNodes.push({x:bodiesByName[d].viewPoints[0][0],y:bodiesByName[d].viewPoints[0][1],fixed:true});
        });
        labelLinks.length = 0;
        labelNodes.forEach(function(d,i){
            if(i%2) return;
            labelLinks.push({source:i+1,target:i});
        });
        forceLabels.nodes(labelNodes).links(labelLinks).start();
        //if you zoom quick, it messes up, needs rate limiting
        if(!t.length) forceLabels.stop();
    }

    //fires every time we need to redraw
    function draw(c){
        //TODO: only draw bodies in frame
        //TODO: figure out if orbits are visible even if object isn't
        c.save();
        c.clearRect(0,0,width,height);
        
        c.translate(center[0],center[1]);
        if(visibleObjects.length < 15){
            visibleObjects.forEach(function(d,i){
                c.save();
                c.translate((d.x+d.center.x)*scale,(d.y+d.center.y)*scale);
                c.strokeStyle = colorUI;
                c.fillStyle = '#fff';
                c.font = '16px sans-serif';
                c.textBaseline = 'bottom';
                var p = [(10*i+10)*Math.cos(d.polarPoints[0][1]+d.yaw),(5*i+10)*Math.sin(d.polarPoints[0][1]+d.yaw)],
                    l = c.measureText(d.name).width;
                c.beginPath();
                c.moveTo(0,0);
                c.lineTo(p[0],p[1]);
                if(p[0] > 0){
                    c.lineTo(p[0]+l,p[1]);
                    c.stroke();
                    c.fillText(d.name,p[0],p[1]);
                }else{
                    c.lineTo(p[0]-l,p[1]);
                    c.stroke();
                    c.fillText(d.name,p[0]-l,p[1]);
                }
                c.restore();
            });
        }
        // if(visibleObjects.length < 15){
        //     c.strokeStyle = colorUI;
        //     c.fillStyle = '#fff';
        //     c.font = '16px sans-serif';
        //     c.textBaseline = 'bottom';
        //     labelLinks.forEach(function(d){
        //         var l = c.measureText(d.target.name);
        //         c.beginPath();
        //         c.moveTo(d.source.x,d.source.y);
        //         c.lineTo(d.target.x,d.target.y);
        //         if(d.target.x > width/2){
        //             c.lineTo(d.target.x+l.width,d.target.y);
        //             c.stroke();
        //             c.fillText(d.target.name,d.target.x,d.target.y);
        //         }else{
        //             c.lineTo(d.target.x-l.width,d.target.y);
        //             c.stroke();
        //             c.fillText(d.target.name,d.target.x-l.width,d.target.y);
        //         }
        //     });
        // }
        //c.translate(center[0],center[1]);
        bodies.forEach(function(d){ d.draw(c); });
        c.restore();
    }

    //#EVENT HANDLERS
    function handleMouseMove(e){
        mousePosition = d3.mouse(this);
    }
    function handleClick(e){
        //highlighted object doesn't change
        if(highlightedObject != -1){
            bodies.forEach(function(d){ d.isFocus = false; })
            bodies[highlightedObject].isFocus = true;
        }
    }
    function handleZoom(){
        //scale = d3.event.scale;
        lastScale = scale;
        scale = zoom.scale();
        coordinates[0] = Math.floor(Math.log(scale/pixelsPerMeter)/Math.log(2));
        //center = d3.event.translate;
        center = zoom.translate();
        coordinates[1] = center[0]/scale;
        coordinates[2] = center[1]/scale;
        coordString = coordinates.join('/');
        location.hash = coordString;
        needsMove = true;
    }
    function handleResize(){
        var min = Math.min(win.innerWidth,win.innerHeight);
        width = min*aspectRatio;
        height = min;
        canvas.width = width;
        canvas.height = height;
        //TODO: change the scaling stuff
    }

    //#OTHER FUNCTIONS
    function changeViewMode(mode){

    }
    function getRadius(body,angle){
        if(!angle) angle = body.trueAnomaly;
        return body.latus / (1 + (body.eccentricity*Math.cos(angle)));
    }
    function zoomTo(z,p){
        //mainContainer.interrupt('zoom');
        zooming = true;
        p[0] *= -z;
        p[0] += width/2;
        p[1] *= -z;
        p[1] += height/2;
        mainContainer.transition().duration(2000).ease('linear').tween('zoom',function(){
            var is = d3.interpolate(zoom.scale(),z);
            var it = d3.interpolate(zoom.translate(),p);
            return function(i){
                zoom.scale(is(i));
                zoom.translate(it(i));
                handleZoom();
            }
        })
        .each('end',function(){ zooming = false; })
        .each('interrupt',function(){ zooming = false; });
    }

    //#BODY DEFINITION
    var bodies = [];
    var bodiesByName = {};
    var bodyTree = [];
    function Body(obj){
        this.id = bodies.length;
        //orbital parameters
        this.majorAxis = 0;
        this.minorAxis = 0;             //calculated
        this.latus = 0;                 //calculated
        this.eccentricity = 0;
        this.linearEccentricity = 0;    //calculated
        this.meanAnomaly = 0;           //this is 
        this.trueAnomaly = 0;           //calculated
        this.eccAnomaly = 0;            //calculated
        this.yaw = 0;                   //really longitude of ascending node
        this.inclination = 0;           //maybe future use, but just make orbit backwards if negative
        this.period = 0;                //calculated
        this.center = {};               //should be an object
        this.satellites = [];
        //physical parameters
        this.radius = 0;
        this.density = 0;
        this.mass = 0;
        this.grav = 0;
        this.albedo = 1;
        this.points = [];
        this.polarPoints = [];
        this.x = 0;                     //these are centroid for regions, otherwise same as points[0]
        this.y = 0;
        //drawing parameters
        this.drawOrbit = true;
        this.drawPoint = true;
        //drawing variables
        this.viewPoints = [];
        this.orbitVisible = true;
        this.orbitMinZoom = 0;
        this.orbitTarget = 0;
        this.orbitAngle = 0;
        this.pointVisible = true;
        this.pointMinZoom = 0;
        this.pointMaxZoom = 0;
        this.pointSize = 5;
        this.highlight = false;
        this.highTarget = 0;
        this.highSize = 0;
        //clerical variables
        this.inView = false;
        this.isFocus = false;


        for(var i in obj){ this[i] = obj[i]; }
        //unit conversions
        if(obj.dist) this.majorAxis *= this.dist;
        this.meanAnomaly *= pi/180;
        this.inclination *= pi/180;
        this.yaw *= pi/180;
        this.mass *= this.type==1?1.98855e30:5.97237e24;
        //orbital parameter calculation
        this.minorAxis = Math.sqrt(1-(this.eccentricity*this.eccentricity))*this.majorAxis;
        this.latus = (this.minorAxis*this.minorAxis)/this.majorAxis;
        this.linearEccentricity = Math.sqrt((this.majorAxis*this.majorAxis)-(this.minorAxis*this.minorAxis));
        this.trueAnomaly = meanToTrue(this.eccentricity,this.meanAnomaly);
        this.eccAnomaly = trueToEcc(this.eccentricity,this.trueAnomaly);
        this.grav = this.mass * 6.67408e-11;
        this.center = bodiesByName[this.primary]||{x:0,y:0};
        //position calculations
        //TODO: Check for single points that aren't wrapped in arrays
        if(this.points.length == 0){
            //planets and such don't have specified points
            this.polarPoints.push([0,0]);
            this.polarPoints[0][1] = this.trueAnomaly;
            this.polarPoints[0][0] = getRadius(this,this.polarPoints[0][1]);
            this.points[0] = [0,0];
            this.points[0][0] = this.polarPoints[0][0] * Math.cos(this.polarPoints[0][1] + this.yaw);
            this.points[0][1] = this.polarPoints[0][0] * Math.sin(this.polarPoints[0][1] + this.yaw);
            this.viewPoints.push([0,0]);
            this.x = this.points[0][0];
            this.y = this.points[0][1];
        }else if(this.points.length == 1){
            //stars and such have specific locations and no polar coordinates
            this.viewPoints.push([0,0]);
            this.x = this.points[0][0];
            this.y = this.points[0][1];
        }else{
            var that = this;
            this.points.forEach(function(d,i){
                that.polarPoints.push([d[0],d[1]*(pi/180)]);
                that.points[i][0] = that.polarPoints[i][0] * Math.cos(that.polarPoints[i][1]) + that.center.x;
                that.points[i][1] = that.polarPoints[i][0] * Math.sin(that.polarPoints[i][1]) + that.center.y;
                that.viewPoints.push([0,0]);
                that.x += that.points[i][0];
                that.y += that.points[i][1];
            });
            this.x /= this.points.length;
            this.y /= this.points.length;
        }
        //rendering calculations
        if(!this.orbitMinZoom) this.orbitMinZoom = Math.floor(Math.log((10/this.majorAxis)/pixelsPerMeter)/Math.log(2));
        if(!this.pointMinZoom) this.pointMinZoom = this.orbitMinZoom + 2;
        if(!this.pointMaxZoom) this.pointMaxZoom = (height/4)/(this.radius||1);
        if(!this.drawColor) this.drawColor = albedoColor(this.albedo||1);
        //clerical
        if(this.primary){
            bodiesByName[this.primary].satellites.push(this);
        }

        bodies.push(this);
        bodiesByName[this.name] = this;
        //TODO: insert into the tree
        return this;
    }
    function tickBody(dt){
        //transitions
        //highlight ring
        var t = this.highTarget - this.highSize;
        if(t > 0.05 || t < -0.05) this.highSize += t*dt*10;
        //draw the orbit around
        t = this.orbitTarget - this.orbitAngle;
        if(t > 0.001){
            this.orbitAngle += t*dt;
        }else{
            this.orbitAngle = this.orbitTarget;
        }
        if(this.orbitAngle < 0) this.orbitAngle = 0;

        //mouseover testing
        var tx = this.viewPoints[0][0] - mousePosition[0], ty = this.viewPoints[0][1] - mousePosition[1];
        this.highlight = (tx > -10 && tx < 10 && ty > -10 && ty < 10);
        if(this.highlight){ highlightedObject = this.id; }
        this.highTarget = this.highlight||this.isFocus?this.pointSize+10:0;
    }
    Body.prototype.tick = tickBody;
    function updateBody(){
        if(viewMode == 1){
            this.inView = (this.x+this.center.x)*scale+center[0] > 0 && (this.x+this.center.x)*scale+center[0] < width
                && (this.y+this.center.y)*scale+center[1] > 0 && (this.y+this.center.y)*scale+center[1] < height;
            var that = this;
            this.points.forEach(function(d,i){
                that.viewPoints[i][0] = (d[0]+that.center.x)*scale + center[0];
                that.viewPoints[i][1] = (d[1]+that.center.y)*scale + center[1];
                if(that.viewPoints[i][0] > 0 && that.viewPoints[i][0] < width
                && that.viewPoints[i][1] > 0 && that.viewPoints[i][1] < height){
                    that.inView = true;
                }
            });
            this.orbitVisible = this.drawOrbit && coordinates[0] > this.orbitMinZoom;
            this.orbitTarget = this.orbitVisible?2*pi:0;
            this.pointVisible = this.drawPoint && coordinates[0] > this.pointMinZoom;
            this.pointSize = Math.max(this.radius*scale,this.satellites.length?2:5);
            if(this.inView && this.pointVisible) visibleObjects.push(this);
        }
    }
    Body.prototype.update = updateBody;
    function drawBody(c){
        if(viewMode != 1) return;
        c.save();
        c.translate(this.center.x*scale,this.center.y*scale);
        if(this.type == 1){
            c.save();
            c.fillStyle = this.drawColor;
            c.beginPath();
            c.moveTo(2,2); c.lineTo(0,12); c.lineTo(-2,2);
            c.lineTo(12,0); c.lineTo(-2,-2); c.lineTo(0,-12);
            c.lineTo(2,-2); c.lineTo(-12,0); c.closePath();
            c.fill();
            c.restore();
        }
        if(this.type == 2){
            c.save();
            if(this.orbitVisible){
                c.save();
                c.rotate(this.yaw);
                c.translate(-this.linearEccentricity*scale,0)
                c.strokeStyle = '#fff';
                c.lineWidth = 0.25;
                c.beginPath();
                c.ellipse(0,0,this.majorAxis*scale,this.minorAxis*scale,0,
                    this.eccAnomaly,this.orbitAngle+this.eccAnomaly,false);
                c.stroke();
                c.restore();
            }
            if(this.pointVisible){
                c.save();
                if(this.points.length == 1){
                    c.translate(this.x*scale,this.y*scale);
                    c.save();
                    c.beginPath();
                    c.arc(0,0,this.highSize,0,2*pi,false);
                    c.strokeStyle = colorUI;
                    c.setLineDash([5,2]);
                    c.stroke();
                    c.restore();
                    c.beginPath();
                    c.arc(0,0,this.pointSize,0,2*pi,false);
                    c.fillStyle = colorPoint;
                    c.fill();
                    c.beginPath();
                    c.arc(0,0,5,0,2*pi,false);
                    c.strokeStyle = colorPoint;
                    c.stroke();
                }else{
                    c.beginPath();
                    c.moveTo(this.points[0][0]*scale,this.points[0][1]*scale);
                    this.points.forEach(function(d){
                        c.lineTo(d[0]*scale,d[1]*scale);
                    });
                    c.closePath();
                    c.fillStyle = '#f0f';
                    c.globalAlpha = 0.2;
                    c.fill();
                }
                c.restore();
            }
            c.restore();
        }
        c.restore();
    }
    Body.prototype.draw = drawBody;

    //#PUBLIC DATA
    var out = {};
    out.bodies = bodies;
    out.bodiesByName = bodiesByName;
    out.bodyTree = bodyTree;
    out.init = init;
    out.test = function(what){
        centerOn(bodiesByName[what].x,bodiesByName[what].y);
    }
    return out;
})(window,document);

window.addEventListener('load',function(){
    Map.init({container:'main-container',data:'sol.json'});
});