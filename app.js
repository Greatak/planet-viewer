var Map = (function(win,doc,undefined){

    //#GLOBAL VARIABLES
    var width = 0,                              //width of the map canvas
        trueWidth = 0,                          //in landscape, center it left, but draw whole screen
        height = 0,                             //height of the map canvas
        aspectRatio = 1,                        //for now we'll just force a square canvas
        mainContainer,                          //where does the canvas go?
        canvas,                                 //where we'll be drawing everything
        ctx,                                    //how we'll draw it
        infoContainer,                          //where to render the infobox in
        pixelsPerMeter = 0;                     //so we can scale to map tiles

    //#STYLE
    var colorPoint = '#FCB52C',
        colorUI = '#5FC2C2',
        fontFamily = 'Open Sans',
        fontSize = '16px';

    //#COMPONENT VARIABLES
    var coordinates = [],                       //zoom,x,y,radius,angle,latitude,longitude, minimum 3
        coordString = '',
        scale = 0,
        center = [0,0],
        transform = {x:0,y:0,k:1},
        mousePosition = [0,0];                  //current mouse position in canvas coordinates

    //##ZOOM BEHAVIOR
    var zoom = d3.zoom()
        .on('zoom',handleZoom);
    var zooming = false,
        lastScale = 0,
        lastZoomTarget = '';

    //##SCALES
    var planetRotation = d3.scaleLinear()      //when we first see a planet, we see it from the north pole
            .range([-90,0])
            .clamp(true);
    var planetWarp = d3.scaleLinear()          //as we zoom in, it unfolds from orthographic to mercator
            .range([0,1])
            .clamp(true);
    var albedoColor = d3.scaleLinear()
            .domain([0,0.5])
            .range(['#555',colorPoint])
            .clamp(true);
    var mapRotation = d3.scaleLinear()
            .range([-180,180]);

    //##PROJECTIONS
    var projOrtho = d3.geoOrthographic()
        .scale(100)
        .translate([width / 2, height / 2])
        .clipAngle(90)
        .precision(1);
    var projMercator = d3.geoMercator();
    //we have to roll a custom projection to handle the unfolding
    var projTransition = interpolatedProjection(projOrtho,projMercator);
    function interpolatedProjection(a, b) {
        var projection = d3.geoProjection(raw).scale(1),
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
        mapName = '',
        oldMapData,                                     //and keep two sets, just in case
        oldMapName = '';

    var path = d3.geoPath();                           //this is just all d3 boilerplate for maps
    var graticule = d3.geoGraticule(),
        graticuleOutline = graticule.outline();
    graticule = graticule();

    //##CLERICAL
    var viewMode = 1,                                   //system or planet mode
        viewTransition = [0,0,0],
        visibleObjects = [],                            //how many distinct objects are visible on screen
        visiblePrimaries = [],                          //how many of them have satellites
        needsMove = true,                               //we won't handle movements unless we've zoomed
        highlightedObject = -1,
        focusedObject = 0;

    //##DEBUGGING
    var fps = 0;
    var planetTest;

    //#INITIALIZATION
    function init(obj){
        //find the container
        //TODO: Make it and add to body if not found, issue warning?
        mainContainer = d3.select('#'+obj.container);
        if(mainContainer.empty()){
            console.error('Could not find container (#' + obj.container + ')');
            return;
        }
        infoContainer = d3.select('#info-container');
        canvas = mainContainer.append('canvas');
        canvas.property('id','map-container');
        ctx = canvas.node().getContext('2d');
        path.context(ctx);
        //set the size of the canvas
        //TODO: custom aspect ratio
        var min = Math.min(win.innerWidth,win.innerHeight);
        trueWidth = win.innerWidth
        width = min*aspectRatio;
        height = min;
        canvas.property('width', trueWidth);
        canvas.property('height', height);
        //set the scales
        //zoom.translateExtent([[-3.5,-3.5],[3.5,3.5]]);
        planetRotation.domain([height/5,height/3]);   //these probably need tweaked
        planetWarp.domain([height/2,height]);

        //add event listeners
        canvas.call(zoom);
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
                if(coordinates.length == 3){
                    scale = Math.pow(2,coordinates[0])*pixelsPerMeter;
                    center[0] = (coordinates[1]*scale);
                    center[1] = (coordinates[2]*scale);
                }else if(coordinates.length == 5){
                    scale = Math.pow(2,coordinates[0])*256;
                    var tx = 0, ty = 0;
                    for(var i = bodies.length;i--;){
                        tx = Math.abs(coordinates[1]-(((-(bodies[i].x+bodies[i].center.x)*scale)+width/2)/scale))/(((-(bodies[i].x+bodies[i].center.x)*scale)+width/2)/scale);
                        ty = Math.abs(coordinates[2]-(((-(bodies[i].y+bodies[i].center.y)*scale)+height/2)/scale))/(((-(bodies[i].y+bodies[i].center.y)*scale)+height/2)/scale);
                        if(i == 3) console.log(bodies[i].name,tx,ty);
                        if(tx < 0.1 && ty < 0.1){
                            viewTransition[2] = i;
                            loadSurface(bodies[i]);
                            console.log(bodies[i].name);
                            break;
                        }
                    }
                    changeViewMode(2);
                    projMercator.scale(scale/2/pi);
                    center = projMercator([coordinates[3],coordinates[4]]);
                    projMercator.translate([center[0],center[1]]);
                }
            }
        }
        var t = d3.zoomIdentity.translate(center[0],center[1]).scale(scale);
        canvas.call(zoom.transform,t);
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
        infoContainer.html('');
        if(highlightedObject != -1){
            bodies[highlightedObject].infobox(infoContainer,true);
        }else{
            bodies[focusedObject].infobox(infoContainer,false);
        }
    }

    //fires every time the view changes probably from zoom()
    function update(){
        needsMove = false;
        if(viewMode == 1){
            //set the coordinates
            coordinates[0] = Math.floor(Math.log(scale/pixelsPerMeter)/Math.log(2));
            coordinates[1] = center[0]/scale;
            coordinates[2] = center[1]/scale;
            coordinates.splice(3,2);
            visibleObjects.length = 0;
            bodies.forEach(function(d){ d.update(); });
            if(visibleObjects.length == 1){
                visibleObjects[0].onlyVisible = true;
                loadSurface(visibleObjects[0]);
                if(visibleObjects[0].pointSize > 20){
                    projTransition.alpha(planetWarp(visibleObjects[0].pointSize));
                    projMercator.scale(visibleObjects[0].pointSize/4);
                    projOrtho.scale(visibleObjects[0].pointSize);
                    projOrtho.rotate([0,planetRotation(visibleObjects[0].pointSize)]);
                    if(projOrtho.rotate()[1] == 0){ 
                        path.projection(projTransition);
                        viewTransition[2] = visibleObjects[0].id;
                        changeViewMode(2);  
                    }
                    else{ path.projection(projOrtho); }
                }
            }
        }else if(viewMode == 2){
            coordinates[0] = Math.floor(Math.log(scale/256)/Math.log(2));
            projMercator.scale(scale/2/pi);
            projMercator.translate([center[0],center[1]]);
            var r = projMercator.invert([width/2,height/2]);
            coordinates[3] = r[0];
            coordinates[4] = r[1];
            projOrtho.scale(scale);
            projOrtho.translate([width/2,center[1]]);
            projTransition.alpha(planetWarp(scale));
            if(scale < 150){
                changeViewMode(1);
            }
        }
        //print coords to the address
        coordString = coordinates.join('/');
        location.hash = coordString;
    }

    //fires every time we need to redraw
    function draw(c){
        //TODO: only draw bodies in frame
        //TODO: figure out if orbits are visible even if object isn't
        c.save();
        c.clearRect(0,0,trueWidth,height);
        if(viewMode == 1){
            c.translate(center[0],center[1]);
            if(visibleObjects.length < 15){
                visibleObjects.forEach(function(d,i){
                    if(!d.drawLabel) return;
                    c.save();
                    c.translate((d.x+d.center.x)*scale,(d.y+d.center.y)*scale);
                    c.strokeStyle = colorUI;
                    c.fillStyle = '#fff';
                    c.font = fontSize + ' ' + fontFamily;
                    c.textBaseline = 'bottom';
                    var p = [(10*i+20+d.pointSize)*Math.cos(d.polarPoints[0][1]+d.yaw),(5*i+20+d.pointSize)*Math.sin(d.polarPoints[0][1]+d.yaw)],
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
            bodies.forEach(function(d){ d.draw(c); });
        }else if(viewMode == 2){
            c.strokeStyle = '#fff';
            c.lineWidth = 0.25;
            c.beginPath();
            path(graticule);
            path(graticuleOutline);
            c.stroke();
            c.lineWidth = 0.5;
            if(mapData){
                mapData.forEach(function(d){
                    c.beginPath();
                    path(d);
                    c.stroke();
                });
            }
        }
        c.restore();
    }

    //#EVENT HANDLERS
    function handleMouseMove(e){
        mousePosition = d3.mouse(this);
    }
    function handleClick(e){
        if(highlightedObject != -1){
            bodies.forEach(function(d){ d.isFocus = false; })
            bodies[highlightedObject].isFocus = true;
            focusedObject = highlightedObject;
        }
    }
    function handleZoom(){
        lastScale = scale;
        scale = d3.event.transform.k;
        center[0] = d3.event.transform.x;
        center[1] = d3.event.transform.y;
        if(viewMode == 2){
            center[0] = Math.min((scale/2)+(width/2),Math.max(-(scale/2)+width/2,center[0]));
            center[1] = Math.min((scale/2)+(height/2),Math.max(-(scale/2)+(height/2),center[1]));
            canvas.node().__zoom.x = center[0];
            canvas.node().__zoom.y = center[1];
        }
        needsMove = true;
    }
    function handleResize(){
        var min = Math.min(win.innerWidth,win.innerHeight);
        trueWidth = win.innerWidth;
        width = min*aspectRatio;
        height = min;
        canvas.property('width',trueWidth);
        canvas.property('height',height);
        //TODO: change the scaling stuff
    }

    //#OTHER FUNCTIONS
    function changeViewMode(mode){
        if(viewMode == mode) return;
        viewMode = mode;
        if(viewMode == 1){
            scale = viewTransition[0];
            projMercator.translate([0,0]);
            projOrtho.translate([0,0]);
            center[0] = (-(bodies[viewTransition[2]].x+bodies[viewTransition[2]].center.x)*scale)+width/2;
            center[1] = (-(bodies[viewTransition[2]].y+bodies[viewTransition[2]].center.y)*scale)+height/2;
            var t = d3.zoomIdentity.translate(center[0],center[1]).scale(scale);
            path.projection(projOrtho);
        }
        if(viewMode == 2){
            viewTransition[0] = 0.9*scale;
            viewTransition[1] = 180;
            console.log(viewTransition[2]);
            coordinates[1] = ((-(bodies[viewTransition[2]].x+bodies[viewTransition[2]].center.x)*viewTransition[0])+width/2)/viewTransition[0];
            coordinates[2] = ((-(bodies[viewTransition[2]].y+bodies[viewTransition[2]].center.y)*viewTransition[0])+height/2)/viewTransition[0];
            center = [width/2,height/2];
            scale = 180;
            projMercator.scale(scale/2/pi);
            projMercator.translate([center[0],center[1]]);
            projOrtho.scale(scale);
            projOrtho.translate([width/2,center[1]]);
            path.projection(projTransition);
            var t = d3.zoomIdentity.translate(center[0],center[1]).scale(scale);
        }
        canvas.call(zoom.transform,t);
    }
    function loadSurface(what){
        if(oldMapName == what.name){
            mapData = oldMapData;
        }else{
            if(what.data){
                d3.json(what.data,function(error,world){
                    if(error) console.log(error);
                    oldMapData = mapData;
                    oldMapName = mapName;
                    mapName = what.name;
                    mapData =  topojson.feature(world, world.objects.contour).features;
                });
            }else{
                oldMapData = mapData;
                oldMapName = mapName;
                mapName = what.name;
                mapData =  null;
            }
        }
    }
    function getRadius(body,angle){
        if(!angle) angle = body.trueAnomaly;
        return body.latus / (1 + (body.eccentricity*Math.cos(angle)));
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
        this.orbitalVelocity = 0;
        this.center = {};               //should be an object
        this.satellites = [];
        //physical parameters
        this.radius = 0;
        this.density = 0;
        this.mass = 0;
        this.grav = 0;
        this.albedo = 1;
        this.surfaceGravity = 0;
        this.temperature = 0;
        this.luminosity = 0;
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
        this.orbitOpacity = 1;
        this.orbitColor = '#fff';
        this.orbitThickness = 0;
        this.orbitDash = [];
        this.pointVisible = true;
        this.pointMinZoom = 0;
        this.pointMaxZoom = 0;
        this.pointSize = 5;
        this.drawOpacity = 1;
        this.drawColor = colorPoint;
        this.drawLabel = true;
        this.highlight = false;
        this.highTarget = 0;
        this.highSize = 0;
        //clerical variables
        this.inView = false;
        this.isFocus = false;
        this.onlyVisible = false;


        for(var i in obj){ this[i] = obj[i]; }
        if(this.orbitThickness){
            this.majorAxis += this.orbitThickness/2;
            this.yaw = Math.random()*360;
        }
        //unit conversions
        if(obj.dist) this.majorAxis *= this.dist;
        this.meanAnomaly *= pi/180;
        this.inclination *= pi/180;
        this.yaw *= pi/180;
        this.mass *= this.type==1?1.98855e30:this.primary=='Sol'?5.97237e24:1;
        //orbital parameter calculation
        this.minorAxis = Math.sqrt(1-(this.eccentricity*this.eccentricity))*this.majorAxis;
        this.latus = (this.minorAxis*this.minorAxis)/this.majorAxis;
        this.linearEccentricity = Math.sqrt((this.majorAxis*this.majorAxis)-(this.minorAxis*this.minorAxis));
        this.trueAnomaly = meanToTrue(this.eccentricity,this.meanAnomaly);
        this.eccAnomaly = trueToEcc(this.eccentricity,this.trueAnomaly);
        this.grav = this.mass * 6.67408e-11;
        this.center = bodiesByName[this.primary]||{x:0,y:0};
        this.period = Math.sqrt((4*pi*pi*this.majorAxis*this.majorAxis*this.majorAxis)/(6.67e-11*(this.center.mass+this.mass)));
        this.orbitalVelocity = Math.sqrt(this.center.grav/(this.majorAxis*(1+((this.eccentricity*this.eccentricity)/2))));
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
            this.x = this.points[0][0] * (obj.dist||1);
            this.y = this.points[0][1] * (obj.dist||1);
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
        //physical parameter calculations
        this.surfaceGravity = this.grav/(this.radius*this.radius);
        if(!this.temperature && this.type == 2){
            var c = this.center,
                d = this.polarPoints[0][0];
            while(!c.luminosity){
                d = c.polarPoints[0][0];
                c = c.center;
            }
            this.temperature = Math.round((Math.pow((c.luminosity * (1-this.albedo))/(4*boltzmann*pi*d*d),0.25)-237.15)*10)/10;
        }
        //rendering calculations
        if(!this.orbitMinZoom) this.orbitMinZoom = Math.floor(Math.log((10/this.majorAxis)/pixelsPerMeter)/Math.log(2));
        if(!this.pointMinZoom) this.pointMinZoom = this.orbitMinZoom + 2;
        if(!this.pointMaxZoom) this.pointMaxZoom = (height/4)/(this.radius||1);
        if(!this.drawColor) this.drawColor = albedoColor(this.albedo||1);
        //clerical
        if(this.primary && this.drawLabel){
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
        if(this.highSize < 0) this.highSize = 0;
        //draw the orbit around
        t = this.orbitTarget - this.orbitAngle;
        if(t > 0.005){
            if(this.drawLabel){
                this.orbitAngle += t*dt;
            }else{
                this.orbitAngle += 5*dt;
            }
        }else{
            this.orbitAngle = this.orbitTarget;
        }
        if(this.orbitAngle < 0) this.orbitAngle = 0;

        //mouseover testing
        if(this.drawLabel){
            var tx = this.viewPoints[0][0] - mousePosition[0], ty = this.viewPoints[0][1] - mousePosition[1];
            this.highlight = (tx > -10 && tx < 10 && ty > -10 && ty < 10);
            if(this.highlight){ highlightedObject = this.id; }
            this.highTarget = this.highlight||this.isFocus?this.pointSize+10:0;
        }
    }
    Body.prototype.tick = tickBody;
    function updateBody(){
        if(viewMode == 1){
            //reset, this is called after bodies loops
            this.onlyVisible = false;
            //does it fit in the screen?
            this.inView = (this.x+this.center.x)*scale+center[0] > 0 && (this.x+this.center.x)*scale+center[0] < width
                && (this.y+this.center.y)*scale+center[1] > 0 && (this.y+this.center.y)*scale+center[1] < height;
            //forEach breaks this
            var that = this;
            //iterate to check multi-point objects
            this.points.forEach(function(d,i){
                that.viewPoints[i][0] = (d[0]+that.center.x)*scale + center[0];
                that.viewPoints[i][1] = (d[1]+that.center.y)*scale + center[1];
                if(that.viewPoints[i][0] > 0 && that.viewPoints[i][0] < width
                && that.viewPoints[i][1] > 0 && that.viewPoints[i][1] < height){
                    that.inView = true;
                }
            });
            //checking zoom levels for orbit trace
            this.orbitVisible = this.drawOrbit && coordinates[0] > this.orbitMinZoom;
            //if we can see it, it does an animation
            this.orbitTarget = this.orbitVisible?2*pi:0;
            //more zoom checking
            this.pointVisible = (this.drawPoint && coordinates[0] > this.pointMinZoom) || this.isFocus;
            //do real-size when close
            this.pointSize = Math.max(this.radius*scale,this.satellites.length?2:5);
            //we want to keep track of all the visible things in frame
            if(this.inView && this.pointVisible) visibleObjects.push(this);
        }
    }
    Body.prototype.update = updateBody;
    function drawBody(c){
        //don't bother if we're in planet mode
        if(viewMode != 1) return;
        c.save();//draw
        c.translate(this.center.x*scale,this.center.y*scale);
        if(this.type == 1){
            //star has custom symbol
            //TODO: Genericize this so you can make anything have custom symbols
            c.save();//star
            c.fillStyle = this.drawColor;
            c.globalAlpha = this.drawOpacity;
            c.translate(this.x*scale,this.y*scale);
            c.beginPath();
            c.moveTo(2,2); c.lineTo(0,12); c.lineTo(-2,2);
            c.lineTo(12,0); c.lineTo(-2,-2); c.lineTo(0,-12);
            c.lineTo(2,-2); c.lineTo(-12,0); c.closePath();
            c.fill();
            c.restore();//star
        }
        if(this.type == 2){
            c.save();//object start
            if(this.orbitVisible){
                //orbit trace
                //TODO: allow data to specify line width
                c.save();//orbit
                c.rotate(this.yaw);
                c.translate(-this.linearEccentricity*scale,0)
                c.strokeStyle = this.orbitColor;
                c.globalAlpha = this.orbitOpacity;
                c.lineWidth = this.orbitThickness*scale||0.25;
                //TODO: Canvas doesn't like large strokes with lineDashArrays
                //c.setLineDash(this.orbitDash);
                c.beginPath();
                c.ellipse(0,0,this.majorAxis*scale,this.minorAxis*scale,0,
                    this.eccAnomaly,this.orbitAngle+this.eccAnomaly,false);
                c.stroke();
                c.restore();//orbit
            }
            if(this.pointVisible){
                //object position
                //TODO: custom symbols
                c.save();//point
                if(this.points.length == 1){
                    //for single point objects
                    c.translate(this.x*scale,this.y*scale);
                    if(this.onlyVisible && this.pointSize > 20){
                        c.strokeStyle = '#fff';
                        c.lineWidth = 0.5;
                        c.beginPath();
                        path(graticuleOutline);
                        if(mapData){
                            mapData.forEach(function(d){
                                path(d);
                            });
                        }
                        c.stroke();
                    }else{
                        c.save();//highlight ring
                        c.beginPath();
                        c.arc(0,0,this.highSize,0,2*pi,false);
                        c.strokeStyle = colorUI;
                        c.setLineDash([5,2]);
                        c.stroke();
                        c.restore();//highlight ring
                        c.beginPath();
                        c.arc(0,0,this.pointSize,0,2*pi,false);
                        c.fillStyle = this.drawColor;
                        c.globalAlpha = this.drawOpacity;
                        c.fill();
                        c.beginPath();
                        c.arc(0,0,5,0,2*pi,false);
                        c.strokeStyle = this.drawColor;
                        c.stroke();
                    }
                }else{
                    //shapes
                    //TODO: These don't render, probably a translation error
                    c.beginPath();
                    c.moveTo(this.points[0][0]*scale,this.points[0][1]*scale);
                    this.points.forEach(function(d){
                        c.lineTo(d[0]*scale,d[1]*scale);
                    });
                    c.closePath();
                    c.fillStyle = this.drawColor;
                    c.globalAlpha = this.drawOpacity;
                    c.fill();
                }
                c.restore();//point
            }
            c.restore();//object
        }
        c.restore();//draw
    }
    Body.prototype.draw = drawBody;
    //TODO: find some way to expose this to customization at startup
    function infoBody(elem,quick){
        var that = this;
        elem.append('h1')
            .text(this.name);
        var e = elem.append('div');
        e.append('span')
            .classed('type',true)
            .text(function(){
                if(that.type == 1){ return 'Star'; }
                else if(that.type == 2){
                    return that.primary == 'Sol'?
                        'Planet':
                        'Moon of ' + that.primary;
                }
            });
        if(this.satellites.length){
            e.append('div')
                .classed('sat-count',true)
                .html('<span>Satellites:</span> ' + this.satellites.length);
        }
        if(!quick){
            elem.append('h2').text('Orbital Characteristics');
            elem.append('p')
                .html('<span>Semi-major axis:</span> '+ (this.majorAxis/1000).toFixed(1) + ' km');
            elem.append('p')
                .html('<span>Eccentricty:</span> '+ this.eccentricity.toFixed(3));
            //TODO: convert to closest timescale
            elem.append('p')
                .html('<span>Orbital period:</span> '+ (this.period/86400).toFixed(1) + ' Earth days');
            elem.append('h2').text('Physical Characteristics');
            elem.append('p')
                .html('<span>Mean radius:</span> '+ (this.radius/1000).toFixed(1) + ' km');
            elem.append('p')
                .html('<span>Mass:</span> '+ this.mass.toExponential(4) + ' kg');
            elem.append('p')
                .html('<span>Surface gravity:</span> '+ this.surfaceGravity.toFixed(1) + ' m/s<sup>2</sup> ' +
                '(' + (this.surfaceGravity/9.81).toFixed(2) + 'g)');
            elem.append('p')
                .html('<span>Albedo:</span> '+ this.albedo);
            elem.append('p')
                .html('<span>Surface Temperature:</span> '+ this.temperature + ' °C');
            if(this.infoText){
                elem.append('h2').text('Other Information');
                elem.append('p').html(this.infoText);
            }
        }else{
            //TODO: This is just all a mess
            //TODO: Delta-V is entirely wrong, probably needs to do rough hohmanns
            //TODO: distance and lag should be given as ranges, probably just apo +- peri
                //could also do getR and use the yaw value we're projecting from
            elem.append('h2').text('Distance from ' + bodies[focusedObject].name);
            var t1 = this.x + this.center.x,
                t2 = bodies[focusedObject].x + bodies[focusedObject].center.x,
                d = Math.sqrt(t1*t1 + t2*t2);
            elem.append('p')
                .html('<span>Distance:</span> ' + (d/1000).toFixed(1) + ' km');
            elem.append('p')
                .html('<span>Light lag:</span> ' + (d/2.998e+8).toFixed(1) + ' seconds');
            d = 0;
            var tree = {};
            t1 = this;
            while(t1.center.name){
                if(!tree[t1.center.name]) tree[t1.center.name] = {};
                if(tree[t1.center.name][t1.name]){ tree[t1.center.name][t1.name] = undefined; }
                else{ tree[t1.center.name][t1.name] = t1.orbitalVelocity; }
                t1 = t1.center;
            }
            t1 = bodies[focusedObject];
            while(t1.center.name){
                if(!tree[t1.center.name]) tree[t1.center.name] = {};
                if(tree[t1.center.name][t1.name]){ tree[t1.center.name][t1.name] = undefined; }
                else{ tree[t1.center.name][t1.name] = t1.orbitalVelocity; }
                t1 = t1.center;
            }
            for(var i in tree){
                t2 = Object.keys(tree[i]);
                if(t2.length == 1){
                    d += tree[i][t2[0]];
                }else{
                    d += Math.abs(tree[i][t2[0]] - tree[i][t2[1]]);
                }
            }
            elem.append('p')
                .html('<span>Delta-v:</span> ' + (d/1000).toFixed(1) + ' km/s (don\'t trust me)');
        }
    }
    Body.prototype.infobox = infoBody;

    //#PUBLIC DATA
    var out = {};
    out.bodies = bodies;
    out.bodiesByName = bodiesByName;
    out.bodyTree = bodyTree;
    out.init = init;
    out.test = function(){
        console.log(projOrtho.invert(mousePosition));
    }
    return out;
})(window,document);

window.addEventListener('load',function(){
    Map.init({container:'main-container',data:'sol.json'});
});