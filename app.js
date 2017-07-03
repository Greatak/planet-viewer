var Map = (function(win,doc,undefined){

    //#GLOBAL VARIABLES
    var width = 0,                              //width of the map canvas
        height = 0,                             //height of the map canvas
        aspectRatio = 1,                        //for now we'll just force a square canvas
        mainContainer,                          //where does the canvas go?
        canvas = $('<canvas#map-canvas>'),      //where we'll be drawing everything
        ctx = canvas.getContext('2d'),          //how we'll draw it
        pixelsPerMeter = 0;                     //so we can scale to map tiles

    //#COMPONENT VARIABLES
    var coordinates = [],                       //zoom,x,y,radius,angle,latitude,longitude, minimum 3
        coordString = '',
        scale = 0,
        center = [0,0],
        mousePosition = [0,0];                  //current mouse position in canvas coordinates

    //##ZOOM BEHAVIOR
    var zoom = d3.behavior.zoom()
        .on('zoom',handleZoom);

    //##SCALES
    var planetRotation = d3.scale.linear()      //when we first see a planet, we see it from the north pole
            .range([-90,0])
            .clamp(true);
    var planetWarp = d3.scale.linear()          //as we zoom in, it unfolds from orthographic to mercator
            .range([0,1])
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

    //##CLERICAL
    var viewMode = 1,                                   //system or planetmode
        visibleObjects = [],                            //how many distinct objects are visible on screen
        visiblePrimaries = [],                          //how many of them have satellites
        needsMove = true;                               //we won't handle movements unless we've zoomed

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
        visibleObjects.forEach(function(d){ d.tick(dt); });
    }

    //fires every time the view changes probably from zoom()
    function update(){
        needsMove = false;
        visibleObjects.length = 0;
        bodies.forEach(function(d){ d.update(); });
        console.log(visibleObjects.length)
    }

    //fires every time we need to redraw
    function draw(c){
        //TODO: only draw bodies in frame
        //TODO: figure out if orbits are visible even if object isn't
        c.save();
        c.clearRect(0,0,width,height);
        c.translate(center[0],center[1]);
        bodies.forEach(function(d){ d.draw(c); });
        c.restore();
    }

    //#EVENT HANDLERS
    function handleMouseMove(e){
        mousePosition = d3.mouse(this);
    }
    function handleClick(e){

    }
    function handleZoom(){
        //scale = d3.event.scale;
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
        d3.transition().duration(500).tween('zoom',function(){
            var is = d3.interpolate(zoom.scale(),Math.pow(2,z)*pixelsPerMeter);
            var it = d3.interpolate(zoom.translate(),p);
            return function(i){
                zoom.scale(is(i));
                zoom.translate(it(i));
                handleZoom();
            }
        });
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
        this.points = [];
        this.polarPoints = [];
        this.x = 0;                     //these are centroid for regions, otherwise same as points[0]
        this.y = 0;
        //drawing parameters
        this.drawOrbit = true;
        this.drawPoint = true;
        //drawing variables
        this.inView = false;
        this.viewPoints = [];
        this.drawAngle = 2*pi;
        this.orbitVisible = true;
        this.orbitMinZoom = 0;
        this.pointVisible = true;
        this.pointMinZoom = 0;
        this.pointSize = 5;


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

    }
    Body.prototype.tick = tickBody;
    function updateBody(){
        if(viewMode == 1){
            this.inView = (this.x+this.center.x)*scale+center[0] > 0 && (this.x+this.center.x)*scale+center[0] < width
                && (this.y+this.center.y)*scale+center[1] > 0 && (this.y+this.center.y)*scale+center[1] < height;
            var that = this;
            this.points.forEach(function(d,i){
                that.viewPoints[i][0] = d[0]*scale + center[0];
                that.viewPoints[i][1] = d[1]*scale + center[1];
                if(that.viewPoints[i][0] > 0 && that.viewPoints[i][0] < width
                && that.viewPoints[i][1] > 0 && that.viewPoints[i][1] < height){
                    that.inView = true;
                }
            });
            this.orbitVisible = this.drawOrbit && coordinates[0] > this.orbitMinZoom;
            this.pointVisible = this.drawPoint && coordinates[0] > this.pointMinZoom;
            this.pointSize = Math.max(this.radius*scale,5);
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
                    this.eccAnomaly,this.drawAngle+this.eccAnomaly,false);
                c.stroke();
                c.restore();
            }
            if(this.pointVisible){
                c.save();
                if(this.points.length == 1){
                    c.translate(this.x*scale,this.y*scale);
                    c.beginPath();
                    c.arc(0,0,this.pointSize,0,2*pi);
                    c.fillStyle = '#ff0';
                    c.fill();
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
    out.test = function(){
        zoomTo(-12,[0,0]);
    }
    return out;
})(window,document);

window.addEventListener('load',function(){
    Map.init({container:'main-container',data:'sol.json'});
});