# zimbra-bot
Discord bot for Zimbra server.

## Install
* install [Node.js](https://nodejs.org/en/)
* install packages: `cd zimbra-bot && npm install`

## Run
* [Create Discord bot and get a token](https://github.com/reactiflux/discord-irc/wiki/Creating-a-discord-bot-&-getting-a-token)
* create the `.env` file, and put the string `BOT_TOKEN={your token here}` into it
* run `npm start`


# Supported commands

## !zimbra help
Prints all supported commands

## !zimbra cal help
Prints help on 'calendar' commands

### !zimbra cal list
Prints all watched calendars

### !zimbra cal watch {name} {url} {auth_token}
Add the calendar to the watch list
* url - calendar URL
* auth_token - Zimbra auth token ([ZM_AUTH_TOKEN](https://wiki.zimbra.com/wiki/Zimbra_REST_API_Reference#Authentication))

### !zimbra cal unwatch {name}
Remove the calendar from the watch list
* url - calendar URL

### !zimbra cal events
Prints upcoming events
