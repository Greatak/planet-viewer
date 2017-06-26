var Map = (function(win,doc,undefined){
    var width = 0,
        height = 0,
        scale = 0,
        center = [0,0],
        viewLock = -1,
        mousePos = [0,0],
        canvas = $('<canvas#main-canvas>'),
        ctx = canvas.getContext('2d'),
        fps = 0;
    
    //basic loop stuff
    var dt = 0,
        oldTime = 0;
    function loop(time){
        requestAnimationFrame(loop);
        dt = (time-oldTime)/1000;
        oldTime = time;
        fps = 1/dt;

        bodies.forEach(function(d){d.update(dt);});
        if(viewLock >= 0){
            center[0] = -bodies[viewLock].x*scale + width/2;
            center[1] = -bodies[viewLock].y*scale + height/2;
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
        c.translate(center[0],center[1]);
    }
    function init(){
        width = win.innerWidth;
        height = win.innerHeight;
        canvas.width = width;
        canvas.height = height;
        $('#main-container')[0].appendChild(canvas);
        zoom.translate([width/2,height/2]);
        center = zoom.translate();

        //load Sol
        d3.json('sol.json',function(data){
            data.forEach(function(d){
                var b = new Body(d);
                if(scale < b.linearEccentricity) scale = b.linearEccentricity;
            });
            scale = (height-40)/(scale);
            zoom.scale(scale);
        });
        d3.json('moons.json',function(data){
            data.forEach(function(d){
                new Body(d);
            });
        });
        d3.select("#main-container").call(zoom);
        d3.select(canvas).on('mousemove',handleMouseMove);
        requestAnimationFrame(loop);
    }
    win.addEventListener('load',init);

    //d3 handles the zooming without much fuss and will later be useful to show surface features of planets
    var zoom = d3.behavior.zoom()
        .on('zoom',handleZoom);
    function handleZoom(){
        //TODO: pan and zoom limits
        scale = d3.event.scale;
        center = d3.event.translate;
    }
    function handleMouseMove(){
        console.log(d3.mouse(this));
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
        this.trueAnomaly = 0;           //calculated
        this.period = 0;

        //other parameters
        this.mass = 0;
        this.grav = 0;                  //calculated

        //drawing variables
        this.r = 0;
        this.x = 0;                     //these are in meters with sun at origin
        this.y = 0;
        this.viewX = 0;                 //these are in pixels relative to viewport
        this.viewY = 0;
        this.drawPeriod = 0;
        this.visible = true;
        this.extraTime = 0;             //save skipped frames so we don't lose orbit sync
        this.highlight = false;

        for(var i in obj) this[i] = obj[i];

        this.center = bodiesByName[this.orbits]||{x:0,y:0};

        //input values are relative to Earth and in degrees because wikipedia uses degrees
        if(this.orbits == "Sol") this.majorAxis *= AU;
        this.meanAnomaly *= pi/180;
        this.inclination *= pi/180;
        this.yaw *= pi/180;
        //local star is relative to the sun though
        this.mass *= this.id?5.97237e24:1.98855e30;

        this.change();

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
            this.period = Math.sqrt((4*pi*pi*this.majorAxis*this.majorAxis*this.majorAxis)/(6.67e-11*(bodies[0].mass+this.mass)));
        }
        this.trueAnomaly = meanToTrue(this.eccentricity,this.meanAnomaly);
        this.r = this.getR(this.trueAnomaly)||0;
        this.x = (this.r * Math.cos(this.trueAnomaly+this.yaw));
        this.y = this.r * Math.sin(this.trueAnomaly+this.yaw);
    }
    Body.prototype.change = changeBody;
    function updateBody(dt){
        this.viewX = ((this.x+this.center.x) * scale) + center[0];
        this.viewY = ((this.y+this.center.y) * scale) + center[1];

        this.visible = this.viewX > 0 && this.viewY > 0 && this.viewX < width && this.viewY < height;
        
        //mouseover testing
        var tx = this.viewX - mousePos[0], ty = this.viewY - mousePos[1];
        this.highlight = tx > -10 && tx < 10 && ty > -10 && ty < 10
    }
    Body.prototype.update = updateBody;
    function drawBody(c,scale){
        c.save();
        if(this.center) c.translate(this.center.x*scale,this.center.y*scale);
        //orbit trace
        //TODO: change prominence of orbits based on scale
        if(scale > (10/this.majorAxis)){
            c.save();
            c.rotate(this.yaw);
            c.translate(-this.linearEccentricity*scale,0)
            c.strokeStyle = '#fff';
            c.lineWidth = 0.25;
            c.beginPath();
            c.ellipse(0,0,this.majorAxis*scale,this.minorAxis*scale,0,
                0,2*pi,false);
            c.stroke();
            c.restore();
        }
        //drawing the body itself, don't do it unless we're kinda close
        //TODO: draw point initially, then a circle depending on size

        if(this.type == 0){
            c.save();
            c.fillStyle = this.drawColor;
            c.beginPath();
            c.moveTo(2,2);
            c.lineTo(0,12);
            c.lineTo(-2,2);
            c.lineTo(12,0);
            c.lineTo(-2,-2);
            c.lineTo(0,-12);
            c.lineTo(2,-2);
            c.lineTo(-12,0);
            c.closePath();
            c.fill();
            c.restore();
        }

        if(this.id && scale > (50/this.majorAxis)){
            //TODO: draw just offscreen stuff too, will depend on size
            if(this.type > 0 && this.visible){
                c.save();
                c.translate(this.x*scale,this.y*scale);
                if(this.highlight){
                    c.fillStyle = "#fff";
                    c.beginPath();
                    c.arc(0,0,10,0,2*pi,false);
                    c.fill();
                    c.fillStyle = "#fff";
                    c.font = '16px sans-serif';
                    c.fillText(this.name,20,-5);
                }
                c.fillStyle = this.drawColor||'#ddd';
                c.beginPath();
                c.arc(0,0,5,0,2*pi,false);
                c.fill();
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
    o.scale = function(){return scale;}
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
var AU = 149598023000;
var pi = Math.PI;