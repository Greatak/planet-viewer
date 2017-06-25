var Map = (function(win,doc,undefined){
    var width = 0,
        height = 0,
        scale = 0,
        center = [0,0],
        canvas = $('<canvas#main-canvas>'),
        ctx = canvas.getContext('2d');

    var dt = 0,
        oldTime = 0;
    function loop(time){
        requestAnimationFrame(loop);
        dt = (time-oldTime)/1000;
        oldTime = time;

        //scale = 0;
        bodies.forEach(function(d){
            d.update(dt); 
            //if(scale < d.linearEccentricity) scale = d.linearEccentricity; 
        });
        //scale = (height/2-40)/(1.5*scale);

        draw(ctx);
        bodies.forEach(function(d){d.draw(ctx,scale);});
        ctx.restore();
    }
    function draw(c){
        c.clearRect(0,0,width,height);
        c.save();
        //c.translate(width/2,height/2);
        c.translate(center[0],center[1]);
        //when we scale the whole canvas, it makes the lines much thinner to the point of being invisible
        //so we should probably handle this in Body.draw so the lines are consistent
        //c.scale(scale,scale);
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
                d.center = bodies[0];
                var b = new Body(d);
                if(scale < b.linearEccentricity) scale = b.linearEccentricity;
            });
            scale = (height-40)/(scale);
            zoom.scale(scale);
        });
        d3.select("#main-container").call(zoom);
        requestAnimationFrame(loop);
    }
    win.addEventListener('load',init);

    var zoom = d3.behavior.zoom()
        .on('zoom',handleZoom);
    function handleZoom(){
        scale = d3.event.scale;
        center = d3.event.translate;
    }

    var bodies = [];
    function Body(obj){
        this.id = bodies.length;
        //orbital parameters
        this.majorAxis = 0;
        this.minorAxis = 0;             //calculated
        this.latus = 0;                 //calculated
        this.eccentricity = 0;
        this.linearEccentricity = 0;    //calculated
        this.meanAnomaly = 0;
        this.yaw = 0;
        this.inclination = 0;
        this.center = {};                //should be an object
        this.trueAnomaly = 0;
        this.period = 0;

        //optional parameters
        this.mass = 0;
        this.grav = 0;                  //calculated

        //drawing variables
        this.r = 0;
        this.x = 0;
        this.y = 0;
        this.yawS = 0;
        this.yawC = 0;
        this.drawPeriod = 0;

        for(var i in obj) this[i] = obj[i];

        this.majorAxis *= AU;
        this.meanAnomaly *= pi/180;
        this.inclination *= pi/180;
        this.yaw *= pi/180;
        this.mass *= this.id?5.97237e24:1.98855e30;

        this.update(0);

        bodies.push(this);
    }
    function updateBody(dt){
        this.minorAxis = Math.sqrt(1-(this.eccentricity*this.eccentricity))*this.majorAxis;
        this.latus = (this.minorAxis*this.minorAxis)/this.majorAxis;
        this.linearEccentricity = Math.sqrt((this.majorAxis*this.majorAxis)-(this.minorAxis*this.minorAxis));
        this.trueAnomaly = meanToTrue(this.eccentricity,this.meanAnomaly);
        this.grav = this.mass * 6.67408e-11;
        if(this.id){
            this.period = Math.sqrt((4*pi*pi*this.majorAxis*this.majorAxis*this.majorAxis)/(6.67e-11*(bodies[0].mass+this.mass)));
            this.drawPeriod = 1/(this.period/1e7);
        }

        this.meanAnomaly += this.drawPeriod*dt;
        this.yawS = Math.sin(this.yaw);
        this.yawC = Math.cos(this.yaw);
        var r = this.getR(this.trueAnomaly);
        this.x = (r * Math.cos(this.trueAnomaly+this.yaw));
        this.y = r * Math.sin(this.trueAnomaly+this.yaw);
    }
    Body.prototype.update = updateBody;
    function drawBody(c,scale){
        c.save();
        c.rotate(this.yaw);
        c.translate(-this.linearEccentricity*scale,0)
        c.strokeStyle = '#fff';
        c.lineWidth = 1;
        c.beginPath();
        c.ellipse(0,0,this.majorAxis*scale,this.minorAxis*scale,0,
            0,2*pi,false);
        c.stroke();
        c.restore();
        if(scale < (100/this.majorAxis)) return;
        c.save();
        c.translate(this.x*scale,this.y*scale);
        c.strokeStyle = '#ff0';
        c.beginPath();
        c.arc(0,0,5,0,2*pi,false);
        c.stroke();
        c.restore();
    }
    Body.prototype.draw = drawBody;
    function bodyGetR(angle){
        if(!angle) angle = this.trueAnomaly;
        return this.latus / (1 + (this.eccentricity*Math.cos(angle)));
    }
    Body.prototype.getR = bodyGetR;

    return bodies;

})(window,document);

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