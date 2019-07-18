const process = require('process');
const Discord = require('discord.js');
const Keyv = require('keyv');
const axios = require('axios');

const checkDbTimeout = 10000;       // 10 sec
const checkURLsTimeout = 120000;    // 120 sec

const helpMsg = new Discord.RichEmbed()
    .setTitle('Command: cal {params}')
    .setDescription('Calendars management')
    .addField('cal list', 'Output all watched calendars')
    .addField('cal watch {name} {url} {auth_token}', `
Add the calendar to the watch list
‣ url - calendar URL
‣ auth_token - Zimbra auth token (ZM_AUTH_TOKEN)`)
    .addField('cal unwatch {name}', `
Remove the calendar from the watch list
‣ url - calendar URL`)
    .addField('cal events', 'Output upcoming events');


//  DB scheme
//
//  {
//    serverId_cal_index: [ 'name' ],
//    serverId_cal_${name}: { name: str, url: str, token: str, channelId: any }
//  }

function get_db() {
  const db = new Keyv('sqlite://./data.sqlite');
  db.on('error', err => console.log('DB Error', err));
  return db;
}

async function get_index(db, serverId) {
  const indexId = `${serverId}_cal_index`;
  const index = await db.get(indexId) || [];
  return [index, indexId];
}

function get_cal_id(serverId, cal_name) {
  return `${serverId}_cal_${cal_name}`;
}

async function get_cal(db, serverId, cal_name) {
  const calId = get_cal_id(serverId, cal_name);
  const cal = await db.get(calId);
  return [cal, calId];
}


//  Watch list scheme
//
// {
//   info: [ { name: str, url: str, token: str, serverId: any, channelId: any } ],
//   events: [ { uid: str, name: str, start: timestamp_ms, alarm: str, desc: str,
//               imageURL: str, serverId: any, channelId: any, timerId: any } ]
// }

const watchList = {
  info: [],
  events: [],

  /** @type {Discord.Client} */
  client: undefined,

  upsert_calendar(cal, serverId) {
    const c = this.info.find(cal_ => { return cal_.name === cal.name &&
                                              cal_.serverId === cal.serverId; });
    if (c === undefined) {
      cal.serverId = serverId;
      this.info.push(cal);
      console.log(`  added cal: ${cal.name}, ${serverId}`);
    } else {
      if (c.url === cal.url && c.token === cal.token && c.channelId === cal.channelId) {
        return false;
      }
      c.url = cal.url;
      c.token = cal.token;
      c.channelId = cal.channelId;
      console.log(`  added cal: ${c.name}, ${serverId}`);
    }
    return true;
  },

  async fetch_calendars() {
    console.log('Getting calendar list from DB...');
    let added = 0;
    const db = get_db();
    const promises  = this.client.guilds.map(async guild => {
      const serverId = guild.id;
      const [index, ] = await get_index(db, serverId);
      const result = [];
      if (index && index.length > 0) for (const name of index) {
        const [cal, ] = await get_cal(db, serverId, name);
        result.push([cal, serverId]);
      }
      return result;
    });
    const items = await Promise.all(promises);
    for (const guild_it of items) {
      for (const cal_it of guild_it) {
        const [cal, serverId] = cal_it;
        if (watchList.upsert_calendar(cal, serverId)) {
          added += 1;
        }

      }
    }
    console.log(`  total: ${added}`);
    return added > 0;
  },

  set_alarm(event) {
    const t = this.calc_alarm_timeout(event);
    if (t > 0) {
      event.timerId = setTimeout((e) => {
        this.show_event(e);
      }, t, event);
      console.log(`  set alarm: ${t}ms`);
    }
  },

  cancel_alarm(event) {
    if (event.timerId !== undefined) {
      clearTimeout(event.timerId);
      event.timerId = undefined;
    }
  },

  calc_alarm_timeout(event) {
    return event.alarm - Date.now();
  },

  show_event(event) {
    this.remove_event(event);
    this.client.channels.get(event.channelId).send(event.desc.includes('"embed"') ?
      JSON.parse(event.desc) :
      new Discord.RichEmbed()
        .setTitle(event.name)
        .setDescription(event.desc)
        .setImage(event.url)
    );
  },

  remove_event(event) {
    const i = this.events.findIndex(e_ => { return e_.uid === event.uid; });
    if (i >= 0) {
      this.events.splice(i, 1);
    }
  },

  upsert_event(event) {
    const e = this.events.find(e_ => { return e_.uid === event.uid; });
    if (e === undefined) {
      this.events.push(event);
      console.log(`  added event: ${event.name}, ${event.uid}`);
      this.set_alarm(event);
    } else {
      this.cancel_alarm(e);
      e.name = event.name;
      e.start = event.start;
      e.alarm = event.alarm;
      e.desc = event.desc;
      e.imageURL = event.imageURL;
      e.channelId = event.channelId;
      console.log(`  updated event: ${e.name}, ${e.uid}`);
      this.set_alarm(e);
    }
  },

  get_event_alarm(start, end, rel) {
    const neg = rel.neg ? -1 : 1;
    let offs = 0;
    if (rel.d) { offs += rel.d * 24 * 3600 * 1000; }
    if (rel.h) { offs += rel.h * 3600 * 1000; }
    if (rel.m) { offs += rel.m * 60 * 1000; }
    if (rel.s) { offs += rel.s * 1000; }
    return (rel.related === 'START' ? start : end) + neg * offs;
  },

  async fetch_events() {
    console.log('Fetching events...');
    const promises = this.info.map(async cal => {
      console.log(`  GET ${cal.url}`);
      const response = await axios.get(`${cal.url}?auth=co&fmt=json&start=0mi&end=1d`, {
        headers: {'Cookie': `ZM_AUTH_TOKEN=${cal.token}`}
      });
      console.log(`    status: ${response.status}`);
      const result = [];
      if (response.status === 200 && response.data.appt) {
        for (const appt of response.data.appt) {
          const comp = appt.inv[0].comp[0];
          result.push({
            uid: comp.uid,
            name: comp.name,
            start: comp.s[0].u,
            end: comp.e[0].u,
            alarm: this.get_event_alarm(comp.s[0].u, comp.e[0].u, comp.alarm[0].trigger[0].rel[0]),
            desc: comp.desc[0]._content,
            imageURL: comp.loc,
            serverId: cal.serverId,
            channelId: cal.channelId
          });
        }
      }
      return result;
    });
    const events = await Promise.all(promises);
    let added = 0;
    for (const arr of events) {
      for (const e of arr) {
        this.upsert_event(e);
        added += 1;
      }
    }
    console.log(`  total: ${added}`);
    return added > 0;
  }
};


function watchDb() {
  if (process.env.CAL_CHANGED) {
    delete process.env.CAL_CHANGED;
    watchList.fetch_calendars().then(res => {
      if (res) {
        console.log(`  updated calendar list`);
        watchList.fetch_events().then(res => {
          if (res) {
            console.log(`  updated event list`);
          }
        });
      }
    });
  }
}


function watchURLs() {
  watchList.fetch_events().then(res => {
    if (res) {
      console.log(`  updated event list`);
    }
  });
}


async function startWatching(client) {
  console.log('Start watching calendars');

  watchList.client = client;

  if (await watchList.fetch_calendars()) {
    await watchList.fetch_events();
  }

  setInterval(watchDb, checkDbTimeout);
  setInterval(watchURLs, checkURLsTimeout);

  return 'OK';
}


async function cal_list(db, serverId) {
  const [index, ] = await get_index(db, serverId);
  if (index.length <= 0) { return '<no calendars>'; }
  const list = [];
  for (const name of index) {
    const [cal, ] = await get_cal(db, serverId, name);
    if (cal !== undefined) { list.push(`${cal.name}: ${cal.url}`); }
    else { console.error(`Error: could not find '${name}' calendar info`); }
  }
  return list.join('\n');
}


async function cal_watch(db, serverId, channelId, name, url, token) {
  const [index, indexId] = await get_index(db, serverId);
  const [cal, calId] = await get_cal(db, serverId, name);
  const c = cal || { name:'', url: '', token: '', channelId: '' };
  if (!index.includes(name)) { index.push(name); }
  c.name = name;
  c.url = url;
  c.token = token;
  c.channelId = channelId;
  if (await db.set(calId, c)) {
    if (await db.set(indexId, index)) {
      process.env.CAL_CHANGED = 1;
      return `OK: watching calendar '${name}'`;
    }
  }
  return `Error: could not watch calendar '${name}'`;
}


async function cal_unwatch(db, serverId, name) {
  const [index, indexId] = await get_index(db, serverId);
  const calId = get_cal_id(serverId, name);
  const i = index.indexOf(name);
  if (i >= 0) {
    index.splice(i, 1);
    if (index.length <= 0 ? !await db.delete(indexId) : !await db.set(indexId, index)) {
      return `Error: could not stop watching calendar '${name}'`;
    }
    await db.delete(calId);
    process.env.CAL_CHANGED = 1;
    return `OK: stopped watching calendar '${name}'`;
  }
  return `There is no such calendar '${name}' in the list`;
}


function cal_events() {
  if (watchList.events.length <= 0) { return '<no events>'; }
  return watchList.events.map(e => {
    const st = new Date(e.start);
    const en = new Date(e.end);
    const al = new Date(e.alarm);
    return  `${e.name}\n` +
            `‣ start: ${st.toString()}\n` +
            `‣ end: ${en.toString()}\n` +
            `‣ alarm: ${al.toString()}\n`;
  }).join('\n');
}


module.exports = {
  name: 'cal',
  description: 'Calendars management',
  usage: 'cal {params}',
  params: true,

  init(client) {
    startWatching(client).then(res => {
      console.log(`Initialized 'cal' command: ${res}`);
    });
  },

  async execute(message, params) {
    if (params[0] === 'help') {
      return message.channel.send(helpMsg);
    }

    const srvId = message.guild ? message.guild.id : message.user.id;
    const db = get_db();

    if (params[0] === 'list') {
      return message.channel.send(await cal_list(db, srvId));
    }

    if (params[0] === 'watch') {
      return params.length < 4 ?
          message.reply(`'cal watch' requires 4 params`) :
          message.channel.send(await cal_watch(db, srvId, message.channel.id, params[1], params[2], params[3]));
    }

    if (params[0] === 'unwatch') {
      return message.channel.send(await cal_unwatch(db, srvId, params[1]));
    }

    if (params[0] === 'events') {
      return message.channel.send(cal_events());
    }

    return message.reply(`Can't perform: 'cal ${params[0]}'`);
  }
}
