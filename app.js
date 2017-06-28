var Map = (function(win,doc,undefined){
    var width = 0,
        height = 0,
        scale = 0,
        initialScale = 0,
        center = [0,0],
        targetCenter = [0,0],
        viewLock = -1,
        mousePos = [0,0],
        visibleObjects = [],
        visiblePrimaries = [],
        activePrimary = '',
        canvas = $('<canvas#main-canvas>'),
        ctx = canvas.getContext('2d'),
        fps = 0;

    //planet drawing setup on D3's end
    var ortho = d3.geo.orthographic()
        .scale(100)
        //.rotate([0,-90])
        .translate([width / 2, height / 2])
        .clipAngle(90)
        .precision(1);
    var mercator = d3.geo.mercator()
        .scale(25)
        .translate([width / 2, height / 2]);
    var projection = interpolatedProjection(ortho,mercator);
    var path = d3.geo.path()
        .projection(projection)
        .context(ctx);
    var graticule = d3.geo.graticule();
    var planetContainer = doc.createElement('planet');
    var planetD = d3.select(planetContainer);
    planetD.datum(graticule);
    var planetTest;
    //planet drawing number tracking
    var planetRotation = d3.scale.linear()
            .range([-90,0])
            .clamp(true);
    var planetWarp = d3.scale.linear()
            .range([0,1])
            .clamp(true);
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
    
    //basic loop stuff
    var dt = 0,
        oldTime = 0,
        offset = 0;
    function loop(time){
        requestAnimationFrame(loop);
        dt = (time-oldTime)/1000;
        oldTime = time;
        fps = 1/dt;

        offset = targetCenter[0] - center[0];
        if(offset < -0.5){ center[0] += 10*offset*dt; }
        else if(offset > 0.5) { center[0] += 10*offset*dt; }
        offset = targetCenter[1] - center[1];
        if(offset < -0.5){ center[1] += 10*offset*dt; }
        else if(offset > 0.5) { center[1] += 10*offset*dt; }

        visiblePrimaries.length = 0;
        visibleObjects.length = 0;
        bodies.forEach(function(d){d.update(dt);});
        if(visiblePrimaries.length == 1) activePrimary = visiblePrimaries[0];
        if(visiblePrimaries.length == 2){
            bodiesByName[visiblePrimaries[1]].isPrimary = true;
            activePrimary = visiblePrimaries[1];
        }
        if(visibleObjects.length == 1){
            bodiesByName[visibleObjects[0]].isPrimary = true;
            activePrimary = visibleObjects[0];
        }
        if(viewLock >= 0){
            targetCenter[0] = (-bodies[viewLock].x-bodies[viewLock].center.x)*scale + width/2;
            targetCenter[1] = (-bodies[viewLock].y-bodies[viewLock].center.y)*scale + height/2;
        }
        //separated for future optimizations
        draw(ctx);
        bodies.forEach(function(d){d.draw(ctx,scale);});
        ctx.restore();
    }
    function draw(c){
        //it's a little derpy with the save/restore points not in the same function but eh
        c.clearRect(0,0,width,height);
        c.save();
        //translate is from the zoom behavior and is in pixel coords
        //bodies are in actual meters so scaling is done on their end, not globally
        //otherwise you get pixel coordinates also scaled down and nothing is visible
        c.translate(center[0],center[1]);
    }
    function init(){
        width = win.innerWidth;
        height = win.innerHeight;
        canvas.width = width;
        canvas.height = height;
        $('#main-container')[0].appendChild(canvas);
        zoom.translate([width/2,height/2]);
        targetCenter = zoom.translate();
        center = targetCenter;
        planetRotation.domain([30,height/2]);
        planetWarp.domain([height/2,height]);

        //load Sol
        d3.json('sol.json',function(data){
            data.forEach(function(d){
                var b = new Body(d);
                if(scale < b.linearEccentricity) scale = b.linearEccentricity;
            });
            scale = (height-40)/(0.5*scale);
            initialScale = scale;
            zoom.scale(scale);
            initSol = true;
            finalize();
        });
        d3.json('moons.json',function(data){
            data.forEach(function(d){
                new Body(d);
            });
            initMoon = true;
            finalize();
        });
        d3.json("earth-contour.json", function(error, world) {
            if (error) throw error;
            planetTest = topojson.mesh(world);
        });
        d3.select("#main-container").call(zoom);
        d3.select(canvas).on('mousemove',handleMouseMove);
    }
    win.addEventListener('load',init);
    //TODO: clean up this finalize function and make it programmatic
    var initSol = false,initMoon = false;
    function finalize(){
        if(!initSol || !initMoon) return;
        bodies.forEach(function(d){ d.change(); });
        requestAnimationFrame(loop);
    }

    //d3 handles the zooming without much fuss and will later be useful to show surface features of planets
    var zoom = d3.behavior.zoom()
        .on('zoom',handleZoom);
    function handleZoom(){
        //TODO: pan and zoom limits
        scale = d3.event.scale;
        center = d3.event.translate;
        targetCenter = center;
    }
    function handleMouseMove(){
        mousePos = d3.mouse(this);
    }

    //keep track of all of 'em for looping
    var bodies = [];
    var bodiesByName = {};
    function Body(obj){
        this.id = bodies.length;
        //orbital parameters
        this.majorAxis = 0;
        this.minorAxis = 0;             //calculated
        this.latus = 0;                 //calculated
        this.eccentricity = 0;
        this.linearEccentricity = 0;    //calculated
        this.meanAnomaly = 0;           //this is 
        this.yaw = 0;                   //really longitude of ascending node
        this.inclination = 0;           //maybe future use, but just make orbit backwards if negative
        this.center = {};               //should be an object
        this.isOrbited = false;
        this.satellites = [];
        this.trueAnomaly = 0;           //calculated
        this.eccAnomaly = 0;            //calculated
        this.period = 0;                //calculated

        //other parameters
        this.mass = 0;
        this.grav = 0;                  //calculated

        //drawing variables
        this.r = 0;
        this.x = 0;                     //these are in meters with sun at origin
        this.y = 0;
        this.viewX = 0;                 //these are in pixels relative to viewport
        this.viewY = 0;
        this.targetSize = 0;
        this.drawSize = 5;
        this.minSize = 0;
        this.targetAngle = 2*pi;
        this.drawAngle = 0;
        this.visible = true;
        this.extraTime = 0;             //save skipped frames so we don't lose orbit sync
        this.highlight = false;
        this.drawObject = false;
        this.drawOrbit = false;
        this.isPrimary = false;

        for(var i in obj) this[i] = obj[i];

        this.center = bodiesByName[this.primary]||{x:0,y:0};

        //input values are relative to Earth and in degrees because wikipedia uses degrees
        if(this.primary == "Sol") this.majorAxis *= AU;
        this.meanAnomaly *= pi/180;
        this.inclination *= pi/180;
        this.yaw *= pi/180;
        //local star is relative to the sun though
        this.mass *= this.id?5.97237e24:1.98855e30;
        this.majorAxis /= 1e6;

        this.change();

        if(this.primary){ 
            bodiesByName[this.primary].isOrbited = true;
            bodiesByName[this.primary].satellites.push(this);
        }

        bodiesByName[this.name] = this;
        bodies.push(this);
    }
    function changeBody(){
        //TODO: only recalc what actually changed, low priority
        this.minorAxis = Math.sqrt(1-(this.eccentricity*this.eccentricity))*this.majorAxis;
        this.latus = (this.minorAxis*this.minorAxis)/this.majorAxis;
        this.linearEccentricity = Math.sqrt((this.majorAxis*this.majorAxis)-(this.minorAxis*this.minorAxis));
        this.grav = this.mass * 6.67408e-11;
        if(this.id){    //sun doesn't orbit
            this.period = Math.sqrt((4*pi*pi*this.majorAxis*this.majorAxis*this.majorAxis)/(6.67e-11*(this.center.mass+this.mass)));
        }
        this.trueAnomaly = meanToTrue(this.eccentricity,this.meanAnomaly);
        this.eccAnomaly = trueToEcc(this.eccentricity,this.trueAnomaly);
        this.r = this.getR(this.trueAnomaly)||0;
        this.x = (this.r * Math.cos(this.trueAnomaly+this.yaw));
        this.y = this.r * Math.sin(this.trueAnomaly+this.yaw);

        if(this.satellites.length){
            this.satellites = this.satellites.sort(function(a,b){ return a.majorAxis - b.majorAxis; });
            var t = this.satellites[0].majorAxis/4;
            this.minSize = t;
            this.satellites.forEach(function(d){ d.minSize = t/2; });
        }
    }
    Body.prototype.change = changeBody;
    function updateBody(dt){
        this.viewX = ((this.x+this.center.x) * scale) + center[0];
        this.viewY = ((this.y+this.center.y) * scale) + center[1];

        if(scale > (10/this.majorAxis)){
            this.drawOrbit = true;
            this.targetAngle = 2*pi;
        }else{
            this.drawOrbit = false;
            this.targetAngle = 0;
        }
        this.drawObject = scale > (50/this.majorAxis) && this.viewX > 0 && this.viewY > 0 && this.viewX < width && this.viewY < height;
        if(this.drawObject && this.drawOrbit) visibleObjects.push(this.name);
        if(this.drawObject && this.drawOrbit && !visiblePrimaries.includes(this.primary)) visiblePrimaries.push(this.primary);
        this.isPrimary = false;

        //point transition effect
        var t = this.targetSize - this.drawSize;
        if(t < -0.25){
            this.drawSize += t*dt*20;
        }else if (t > 0.25){
            this.drawSize += t*dt*10;
        }
        if(this.drawSize < 0) this.drawSize = 0;
        //orbit transition effect
        t = this.targetAngle - this.drawAngle;
        if(t > 0.001){
            this.drawAngle += t*dt;
        }else{
            this.drawAngle = this.targetAngle;
        }
        if(this.drawAngle < 0) this.drawAngle = 0;

        //mouseover testing
        var tx = this.viewX - mousePos[0], ty = this.viewY - mousePos[1];
        this.highlight = tx > -10 && tx < 10 && ty > -10 && ty < 10
    }
    Body.prototype.update = updateBody;
    function drawBody(c,scale){
        c.save();
        //keep everything relative to it's orbital primary
        c.translate(this.center.x*scale,this.center.y*scale);
        if(this.type == 1){         //star
            c.save();
            c.fillStyle = this.drawColor;
            c.beginPath();
            c.moveTo(2,2); c.lineTo(0,12); c.lineTo(-2,2);
            c.lineTo(12,0); c.lineTo(-2,-2); c.lineTo(0,-12);
            c.lineTo(2,-2); c.lineTo(-12,0); c.closePath();
            c.fill();
            c.restore();
        }
        if(this.type == 2){         //planet/moon
            //orbit trace
            if(this.drawOrbit && this.primary == activePrimary){
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
            //point
            if(this.drawOrbit && this.drawObject){
                c.save();
                c.translate(this.x*scale,this.y*scale);
                if(this.highlight || visibleObjects.length < 6){
                    c.fillStyle = "#fff";
                    c.beginPath();
                    c.arc(0,0,10,0,2*pi,false);
                    c.fill();
                    c.fillStyle = "#fff";
                    c.font = '16px sans-serif';
                    c.fillText(this.name,20,0);
                }
                c.fillStyle = '#0aa';
                c.beginPath();
                if(this.isPrimary){
                    this.targetSize = Math.max(this.minSize*scale,15);
                    if(this.targetSize > 15){
                        viewLock = this.id;
                        projection.alpha(planetWarp(this.drawSize)); 
                        ortho.scale(this.drawSize);
                        mercator.scale(this.drawSize/4);
                        //ortho.rotate([0,planetRotation(this.drawSize)]);
                        c.strokeStyle = '#fff';
                        c.lineWidth = 0.5;
                        c.beginPath();
                        path(graticule());
                        c.stroke();
                        if(this.name == 'Earth'){
                            c.lineWidth = 1;
                            c.beginPath();
                            path(planetTest);
                            c.stroke();
                        }
                    }else{
                        viewLock = -1;
                        c.beginPath();
                        c.arc(0,0,this.drawSize,0,2*pi,false);
                        c.fill();
                    }
                    c.strokeStyle = "#0dd";
                    if(this.isOrbited){
                        c.setLineDash([5,2]);
                        c.lineWidth = 0.5;
                    }else{
                        c.setLineDash([1,5]);
                        c.lineWidth = 3;
                    }
                    c.beginPath();
                    c.arc(0,0,this.drawSize+5,0,2*pi,false);
                    c.stroke();
                }else{
                    this.targetSize = 5;
                    c.arc(0,0,this.drawSize,0,2*pi,false);
                    c.fill();
                }
                c.restore();
            }
        }
        c.restore();
    }
    Body.prototype.draw = drawBody;
    function bodyGetR(angle){
        if(!angle) angle = this.trueAnomaly;
        return this.latus / (1 + (this.eccentricity*Math.cos(angle)));
    }
    Body.prototype.getR = bodyGetR;

    var o = {};
    o.bodies = bodies;
    o.bodiesByName = bodiesByName;
    o.scale = function(){return scale;}
    o.primaries = function(){return activePrimary;}
    o.warp = function(){return planetW;}
    return o;

})(window,document);

//who needs jquery
function $(what){
    if(what.startsWith('<') && what.endsWith('>')){
        what = what.substring(1,what.length-1);
        what = what.split('#');
        var id = '';
        if(what.length == 2) var id = what.pop();
        what = what[0].split('.');
        var el = document.createElement(what.shift());
        if(id) el.id = id;
        what.forEach(function(e){
            el.className += ' ' + e;
        });
        return el;
    }else{
        return document.querySelectorAll(what);
    }
}
//astronomers suck, but there is no better way
function meanToTrue(ecc, anom){
        var a = anom%(2*pi);
        if(a < pi){
            a += 2*pi;
        }else if(a > pi){
            a -= 2*pi
        }
        var t = 0;
        if((a > -pi && a < 0) || a > pi){
            t = a - ecc;
        }else{
            t = a + ecc;
        }

        var t1 = a;
        var first = true;
        while (first || Math.abs(t1 - t) > 1e-6){
            first = 0;
            t = t1;
            t1 = t + (a - t + (ecc*Math.sin(t)))/(1 - (ecc*Math.cos(t)));
        }   
        t = t1;

        var sinf = Math.sin(t)*Math.sqrt(1 - (ecc*ecc))/(1 - (ecc * Math.cos(t)));
        var cosf = (Math.cos(t) - ecc)/(1 - (ecc * Math.cos(t)));
        return Math.atan2(sinf,cosf);
    }
function trueToEcc(ecc,anom){
    var sinE = Math.sin(anom)*Math.sqrt(1 - ecc*ecc)/(1 + ecc * Math.cos(anom));
    var cosE = (ecc + Math.cos(anom))/(1 + ecc * Math.cos(anom));
    return Math.atan2(sinE, cosE);
}
var AU = 149598023000;
var pi = Math.PI;