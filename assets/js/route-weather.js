(function(){
  'use strict';
  var config=window.ROUTE_WEATHER_CONFIG;
  var snapshot=window.ROUTE_WEATHER_SNAPSHOT||{};
  if(!config||!config.routes)return;

  var weatherNames={0:'晴',1:'大致晴',2:'多云',3:'阴',45:'雾',48:'雾凇',51:'毛毛雨',53:'毛毛雨',55:'较强毛毛雨',56:'冻毛毛雨',57:'强冻毛毛雨',61:'小雨',63:'中雨',65:'大雨',66:'冻雨',67:'强冻雨',71:'小雪',73:'中雪',75:'大雪',77:'雪粒',80:'阵雨',81:'较强阵雨',82:'强阵雨',85:'阵雪',86:'强阵雪',95:'雷暴',96:'雷暴伴冰雹',99:'强雷暴伴冰雹'};
  var fields=['weather_code','temperature_2m_max','temperature_2m_min','apparent_temperature_max','precipitation_sum','precipitation_probability_max','wind_gusts_10m_max'];

  function isoDate(date){return date.toISOString().slice(0,10);}
  function dateFromIso(value){var parts=value.split('-').map(Number);return new Date(Date.UTC(parts[0],parts[1]-1,parts[2]));}
  function addDays(value,days){var d=typeof value==='string'?dateFromIso(value):new Date(value.getTime());d.setUTCDate(d.getUTCDate()+days);return isoDate(d);}
  function tomorrow(){var d=new Date();return isoDate(new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()+1)));}
  function shortDate(value){var p=value.split('-');return Number(p[1])+'月'+Number(p[2])+'日';}
  function safeNumber(value,fallback){var n=Number(value);return Number.isFinite(n)?n:fallback;}

  function readDay(location,date){
    if(!location||!location.daily||!Array.isArray(location.daily.time))return null;
    var index=location.daily.time.indexOf(date);
    if(index<0)return null;
    var result={date:date};
    fields.forEach(function(field){result[field]=location.daily[field]&&location.daily[field][index];});
    return result;
  }

  function assess(day,route){
    if(!day)return {status:'unknown',label:'超出预报期',reason:'当前预报未覆盖这一天'};
    var code=safeNumber(day.weather_code,0);
    var rain=safeNumber(day.precipitation_sum,0);
    var probability=safeNumber(day.precipitation_probability_max,0);
    var gust=safeNumber(day.wind_gusts_10m_max,0);
    var max=safeNumber(day.temperature_2m_max,0);
    var apparent=safeNumber(day.apparent_temperature_max,max);
    var min=safeNumber(day.temperature_2m_min,99);
    var red=[];var amber=[];
    if(code>=95)red.push('雷暴');
    if(rain>=25)red.push('大雨');
    if(gust>=75)red.push('强阵风');
    if(max>=38)red.push('极端高温');
    if(apparent>=42)red.push('体感酷热');
    if(code>=80&&code<95)amber.push('阵雨');
    if(probability>=60)amber.push('降雨概率高');
    if(rain>=10&&rain<25)amber.push('中到大雨');
    if(gust>=50&&gust<75)amber.push('风力偏强');
    if(max>=35&&max<38)amber.push('高温');
    if(apparent>=38&&apparent<42)amber.push('体感炎热');
    if(route.highAltitude&&min<=4)amber.push('高海拔低温');
    if(red.length)return {status:'red',label:'不建议按原计划',reason:red.join('、')};
    if(amber.length)return {status:'amber',label:'需要调整',reason:Array.from(new Set(amber)).join('、')};
    return {status:'green',label:'目前可去',reason:'未见强降雨、雷暴、强风或极端高温信号'};
  }

  function overall(days,route){
    var assessments=days.map(function(item){return assess(item.weather,route);});
    var typhoon=snapshot.typhoon||{};
    var hasRed=assessments.some(function(item){return item.status==='red';});
    var hasAmber=assessments.some(function(item){return item.status==='amber';});
    var allUnknown=assessments.every(function(item){return item.status==='unknown';});
    if(typhoon.active&&route.coastal)return {status:'red',label:'先不要锁死',reason:'中央气象台有台风预警，海岛船班和华南大交通需重新核对'};
    if(typhoon.active&&!hasRed)return {status:'amber',label:'先核对大交通',reason:'中央气象台有台风预警，广州/佛山出发航班或列车可能受影响'};
    if(hasRed)return {status:'red',label:'不建议按原计划',reason:'至少一天出现雷暴、大雨、强风或极端高温风险'};
    if(hasAmber)return {status:'amber',label:'能去但要调整',reason:'沿线存在降雨、风力、高温或高海拔低温风险，按每日卡删减'};
    if(allUnknown)return {status:'unknown',label:'暂不能判断',reason:'旅行日期超出未来16天预报范围，请临近出发再看'};
    return {status:'green',label:'目前可以去',reason:'预报覆盖期内未见需要取消整条路线的天气信号'};
  }

  function buildDays(route,start,locations){
    return route.days.map(function(item){
      var date=addDays(start,item.offset);
      return {config:item,date:date,weather:readDay(locations[item.location],date)};
    });
  }

  function weatherDetails(day){
    if(!day)return '等待临近日期预报';
    var code=weatherNames[day.weather_code]||('天气代码'+day.weather_code);
    return code+'｜'+Math.round(day.temperature_2m_min)+'–'+Math.round(day.temperature_2m_max)+'℃｜降雨'+safeNumber(day.precipitation_probability_max,0)+'%';
  }

  function riskDetails(day){
    if(!day)return '当前仅提供未来16天预报';
    return '雨量 '+safeNumber(day.precipitation_sum,0)+'mm｜阵风 '+Math.round(safeNumber(day.wind_gusts_10m_max,0))+'km/h｜体感最高 '+Math.round(safeNumber(day.apparent_temperature_max,day.temperature_2m_max))+'℃';
  }

  function renderPanel(routeId,route,locations,start,sourceLabel){
    var panel=document.querySelector('.route-weather-panel');
    if(!panel)return;
    var days=buildDays(route,start,locations);
    var verdict=overall(days,route);
    var typhoon=snapshot.typhoon||{};
    var generated=snapshot.generatedAt?new Date(snapshot.generatedAt).toLocaleString('zh-CN',{hour12:false}):'未知';
    panel.querySelector('.weather-live-badge').textContent=sourceLabel;
    var verdictNode=panel.querySelector('.weather-overall');
    verdictNode.dataset.status=verdict.status;
    var dateContext=route.departureDate?'游玩段按 <b>'+shortDate(start)+'</b> 起算；大交通出发日为 <b>'+shortDate(route.departureDate)+'</b>，广州/佛山天气与台风需同时核对。':'当前按 <b>'+shortDate(start)+'</b> 出发逐日判断。';
    verdictNode.innerHTML='<div class="weather-verdict">'+verdict.label+'</div><div class="weather-reason">'+verdict.reason+'。'+dateContext+'</div>';
    panel.querySelector('.weather-days').innerHTML=days.map(function(item){
      var result=assess(item.weather,route);
      return '<article class="weather-day" data-status="'+result.status+'"><strong>D'+item.config.day+'｜'+shortDate(item.date)+'</strong><div class="weather-place">'+config.locations[item.config.location].name+' · '+item.config.label+'</div><div class="weather-main">'+weatherDetails(item.weather)+'</div><small>'+riskDetails(item.weather)+'</small><small><b>'+result.label+'：</b>'+result.reason+'</small></article>';
    }).join('');
    var typhoonText=typhoon.summary||'台风数据暂未取得，请点击中央气象台人工核对。';
    panel.querySelector('.typhoon-copy').innerHTML='<h3>台风预报｜'+(typhoon.active===true?'有预警':typhoon.active===false?'当前无生效预警':'需人工核对')+'</h3><p>'+typhoonText+'</p>';
    panel.querySelector('.weather-foot').textContent='天气：Open-Meteo逐日预报；台风：中央气象台官方页面。快照更新时间 '+generated+'，页面打开时会再尝试刷新。预报会变化，船班、索道、航班和景区是否开放仍以当天官方公告为准。';
  }

  function makePanel(routeId,route,start){
    var panel=document.createElement('section');
    panel.className='route-weather-panel';
    panel.id='route-weather';
    panel.innerHTML='<div class="weather-head"><div><h2>天气与台风实时判断</h2><p>'+route.name+(route.dateLabel?'｜'+route.dateLabel:'')+'｜先看能不能去，再决定是否锁票和酒店。</p></div><span class="weather-live-badge">发布快照</span></div>'+
      '<div class="weather-controls"><label>推算出发日期<input class="weather-date" type="date" value="'+start+'"></label><button class="weather-refresh" type="button">按此日期判断</button><a class="weather-official-link" href="https://www.nmc.cn/publish/typhoon/warning_index.html" target="_blank" rel="noopener">中央气象台台风</a></div>'+
      '<div class="weather-overall" data-status="unknown"><div class="weather-verdict">正在判断</div><div class="weather-reason">读取逐日预报中。</div></div><div class="weather-days"></div>'+
      '<div class="typhoon-card"><div class="typhoon-copy"><h3>台风预报</h3><p>读取中央气象台发布快照。</p></div><a class="weather-official-link" href="https://www.nmc.cn/publish/typhoon/warning_index.html" target="_blank" rel="noopener">打开官方预警</a></div><p class="weather-foot"></p>';
    var main=document.querySelector('main');
    if(main)document.body.insertBefore(panel,main);else document.body.appendChild(panel);
    panel.querySelector('.weather-refresh').addEventListener('click',function(){
      var value=panel.querySelector('.weather-date').value;
      if(!value)return;
      try{localStorage.setItem('route-weather-date-'+routeId,value);}catch(e){}
      refreshRoute(routeId,route,value);
    });
    return panel;
  }

  function fetchLocation(id){
    var loc=config.locations[id];
    var params=new URLSearchParams({latitude:String(loc.lat),longitude:String(loc.lon),daily:fields.join(','),timezone:'Asia/Shanghai',forecast_days:String(config.forecastDays||16)});
    return fetch('https://api.open-meteo.com/v1/forecast?'+params.toString()).then(function(response){if(!response.ok)throw new Error('HTTP '+response.status);return response.json();}).then(function(data){return [id,{name:loc.name,daily:data.daily}];});
  }

  function refreshRoute(routeId,route,start){
    var unique=Array.from(new Set(route.days.map(function(item){return item.location;})));
    Promise.all(unique.map(fetchLocation)).then(function(results){
      var live=Object.assign({},snapshot.locations||{},Object.fromEntries(results));
      renderPanel(routeId,route,live,start,'实时预报');
    }).catch(function(){renderPanel(routeId,route,snapshot.locations||{},start,'发布快照');});
  }

  function routeIdFromHref(href){
    var name=(href||'').split('/').pop().replace('.html','');
    return name==='jiuzhaigou-7days'?'jiuzhaigou-7days':name;
  }

  function renderIndex(){
    document.querySelectorAll('.route-tile').forEach(function(tile){
      var routeId=routeIdFromHref(tile.getAttribute('href'));
      var route=config.routes[routeId];
      if(!route)return;
      var start=route.fixedStart||tomorrow();
      var result=overall(buildDays(route,start,snapshot.locations||{}),route);
      var badge=document.createElement('span');
      badge.className='route-live-status';badge.dataset.status=result.status;
      badge.textContent=(route.fixedStart?'计划日期':'未来预演')+'：'+result.label;
      var summary=tile.querySelector('.route-summary');
      if(summary)summary.appendChild(badge);
    });
  }

  var routeId=document.body.getAttribute('data-route-id');
  if(routeId&&config.routes[routeId]){
    var route=config.routes[routeId];
    var stored='';try{stored=localStorage.getItem('route-weather-date-'+routeId)||'';}catch(e){}
    var start=stored||route.fixedStart||tomorrow();
    makePanel(routeId,route,start);
    renderPanel(routeId,route,snapshot.locations||{},start,'发布快照');
    refreshRoute(routeId,route,start);
  }else if(document.body.hasAttribute('data-weather-index')){
    renderIndex();
  }
})();
