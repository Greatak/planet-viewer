var list = document.querySelectorAll('a + table hr + table tr[align=right]');
var moons = [];

list.forEach(function(d){
    var obj = {};
    var where = d.parentElement.parentElement.parentElement.parentElement.parentElement.children[0].children[0].textContent.split(' ');
    obj.orbits = where[2];
    obj.type = 2;
    obj.name = d.children[0].textContent;
    obj.majorAxis = parseFloat(d.children[1].textContent) * 1000;
    obj.eccentricity = parseFloat(d.children[2].textContent);
    obj.meanAnomaly = parseFloat(d.children[4].textContent);
    obj.yaw = parseFloat(d.children[6].textContent);
    moons.push(obj);
});