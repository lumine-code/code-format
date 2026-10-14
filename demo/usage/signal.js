const samples=[.2,.8,-.4,.5];
function average(values){return values.reduce((sum,value)=>sum+value,0)/values.length}
console.log(average(samples));
