/**
 * A Bot for Slack!
 */

// TODO:
// - store the standup time per channel
// - store the standup report per user per channel
// - write the loop that checks if a standup report time has occurred
// - write the function that sends all the standup reports to the channel

 /**
  * the time that this bot will report the standup results.
  * also stored in (as backup): 
  */
var standupTime = null;

/**
 * Define a function for initiating a conversation on installation
 * With custom integrations, we don't have a way to find out who installed us, so we can't message them :(
 */

function onInstallation(bot, installer) {
    if (installer) {
        bot.startPrivateConversation({user: installer}, function (err, convo) {
            if (err) {
                console.log(err);
            } else {
                convo.say('I am a bot that has just joined your team');
                convo.say('You must now /invite me to a channel so that I can be of use!');
            }
        });
    }
}


/**
 * Configure the persistence options
 */

var config = {};
if (process.env.MONGOLAB_URI) {
    var BotkitStorage = require('botkit-storage-mongo');
    config = {
        storage: BotkitStorage({mongoUri: process.env.MONGOLAB_URI}),
    };
} else {
    config = {
        json_file_store: ((process.env.TOKEN)?'./db_slack_bot_ci/':'./db_slack_bot_a/'), //use a different name if an app or CI
    };
}

/**
 * Are being run as an app or a custom integration? The initialization will differ, depending
 */

if (process.env.TOKEN || process.env.SLACK_TOKEN) {
    //Treat this as a custom integration
    var customIntegration = require('./lib/custom_integrations');
    var token = (process.env.TOKEN) ? process.env.TOKEN : process.env.SLACK_TOKEN;
    var controller = customIntegration.configure(token, config, onInstallation);
} else if (process.env.CLIENT_ID && process.env.CLIENT_SECRET && process.env.PORT) {
    //Treat this as an app
    var app = require('./lib/apps');
    var controller = app.configure(process.env.PORT, process.env.CLIENT_ID, process.env.CLIENT_SECRET, config, onInstallation);
} else {
    console.log('Error: If this is a custom integration, please specify TOKEN in the environment. If this is an app, please specify CLIENTID, CLIENTSECRET, and PORT in the environment');
    process.exit(1);
}


/**
 * A demonstration for how to handle websocket events. In this case, just log when we have and have not
 * been disconnected from the websocket. In the future, it would be super awesome to be able to specify
 * a reconnect policy, and do reconnections automatically. In the meantime, we aren't going to attempt reconnects,
 * WHICH IS A B0RKED WAY TO HANDLE BEING DISCONNECTED. So we need to fix this.
 *
 * TODO: fixed b0rked reconnect behavior
 */
// Handle events related to the websocket connection to Slack
controller.on('rtm_open', function (bot) {
    console.log('** The RTM api just connected!');
});

controller.on('rtm_close', function (bot) {
    console.log('** The RTM api just closed');
    // you may want to attempt to re-open
});


/**
 * Core bot logic goes here!
 */
// BEGIN EDITING HERE!

// when someone @-mentions the bot and says standup, start a convo and save the results (per channel, in case of multiples)
controller.hears('standup', 'direct_mention', function(bot, message) {
    var userName = null;
    getUserName(bot, message.user, function(err, name) {
        if (!err && name) {
            userName = name;
            bot.startPrivateConversation({
                user: message.user
            }, function(err, convo) {
                if (!err && convo) {
                    var standupReport = 
                    {
                        channel: message.channel,
                        user: message.user,
                        userName: userName,
                        datetime: getDateTime(),
                        yesterdayQuestion: null,
                        todayQuestion: null,
                        obstacleQuestion: null
                    };
                    convo.ask('What did you work on yesterday?', function(response, convo) {
                        standupReport.yesterdayQuestion = response.text;
        
                        convo.ask('What are you working on today?', function(response, convo) {
                            standupReport.todayQuestion = response.text;
        
                            convo.ask('Any obstacles?', function(response, convo) {
                                standupReport.obstacleQuestion = response.text;
        
                                convo.next();
                            });
                            convo.say('Thanks for doing your daily standup, ' + userName + "!");
        
                            convo.next();
                        });
                        
                        convo.next();
                    });
        
                    convo.on('end', function() {
                        // eventually this is where the standupReport should be stored
                        bot.say({
                            channel: standupReport.channel,
                            //text: "*" + standupReport.userName + "* did their standup at " + standupReport.datetime
                            text: displaySingleReport(bot, standupReport),
                            mrkdwn: true
                        });
                    });
                }
            });
        }
    });
});

function displaySingleReport(bot, standupReport)
{
    var report = "*" + standupReport.userName + "* did their standup at " + standupReport.datetime + "\n";
    report += "_What did you work on yesterday:_ `" + standupReport.yesterdayQuestion + "`\n";
    report += "_What are you working on today:_ `" + standupReport.todayQuestion + "`\n";
    report += "_Any obstacles:_ `" + standupReport.obstacleQuestion + "`\n\n";
    return report;
}

// when the time to report is hit, report the standup, clear the storage
function loop(bot) {

    if (!standupTime) {
        return;
    }
}

// set the report time
controller.hears('settime', 'direct_mention', function(bot, message) {
    var standupTimeToSet = null;

    bot.startPrivateConversation({
        user: message.user
    }, function(err, convo) {
        if (!err && convo) {
            convo.say('You asked to set the time of the standup report!');
            convo.ask('What time would you like to generate the standup report? (hh:mm, in 24h time)', function(response, convo) {
                standupTimeToSet = getHoursAndMinutesFromResponse(response.text);
                if (standupTimeToSet) {
                    
                    // TODO: store this!!
                    standupTimeToSet.channel = message.channel;

                    convo.say('Standup reporting time has been changed to `' + standupTimeToSet.hours + ':' + standupTimeToSet.minutes + '`.');
                    bot.say({
                        channel: message.channel,
                        text: '*Attention*: standup reporting time has been changed to `' + standupTimeToSet.hours + ':' + standupTimeToSet.minutes + '`.',
                        mrkdwn: true
                    });                    
                } else {
                    convo.say('Error reading the entered time, standup time not set.');
                    convo.repeat();
                }

                convo.next();
            });

        }
    })
});

function getHoursAndMinutesFromResponse(responseText) {
    console.log('response length: ' + responseText.length);
    if (responseText.length != 5) { return null; }

    let hoursInt = parseInt(responseText);
    let minutesInt = parseInt(responseText.substring(3,5));
    console.log('Hours: ' + hoursInt + ' Minutes: ' + minutesInt);

    if (!hoursInt || hoursInt <= 0 || hoursInt > 23) { return null; }
    if (!minutesInt || minutesInt < 0 || minutesInt > 59 ) { return null; }

    console.log('returning');
    return { hours: hoursInt, minutes: minutesInt };
}

function getDateTime() {

    var date = new Date();

    var hour = date.getHours();
    hour = (hour < 10 ? "0" : "") + hour;

    var min  = date.getMinutes();
    min = (min < 10 ? "0" : "") + min;

    var year = date.getFullYear();

    var month = date.getMonth() + 1;
    month = (month < 10 ? "0" : "") + month;

    var day  = date.getDate();
    day = (day < 10 ? "0" : "") + day;

    return year + "-" + month + "-" + day + ": " + hour + ":" + min;
}

function getChannelName(bot, channel, cb) {
    bot.api.channels.info({ channel: channel }, function (err, results) {
        if (results.ok && results.ok === true) {
            cb(null, results.channel.name);
        }
    });      
}

function getUserName(bot, userId, cb)
{
    bot.api.users.info({ user: userId }, function(err, results) {
        if (results.ok && results.ok === true) {
            cb(null, results.user.name);
        }
    });
}

/**
 * AN example of what could be:
 * Any un-handled direct mention gets a reaction and a pat response!
 */
//controller.on('direct_message,mention,direct_mention', function (bot, message) {
//    bot.api.reactions.add({
//        timestamp: message.ts,
//        channel: message.channel,
//        name: 'robot_face',
//    }, function (err) {
//        if (err) {
//            console.log(err)
//        }
//        bot.reply(message, 'I heard you loud and clear boss.');
//    });
//});

controller.hears('whoami', 'ambient', function(bot, message){
    bot.reply(message, "userId: " + message.user);
    getUserName(bot, message.user, function(err, userName) {
        if (!err) {
            bot.reply(message, "userName: " + userName);
        }
    });
});

controller.hears('whereami', 'ambient', function(bot, message){
    bot.reply(message, "channelId: " + message.channel);
    getChannelName(bot, message.channel, function(err, channelName) {
        if (!err) {
            bot.reply(message, "channelName: " + channelName);
        }
    });
});

controller.on('bot_channel_join', function (bot, message) {
    bot.reply(message, "I'm here!")
});

controller.hears('hello', 'direct_message', function (bot, message) {
    bot.reply(message, 'Hello!');
});

controller.hears(
    ['hello', 'hi', 'greetings'],
    ['direct_mention', 'mention', 'direct_message'],
    function(bot,message) {
        bot.reply(message,'shaddup yer face!');
    }
);

controller.on('member_joined_channel', function(bot, message) {
    bot.reply(message,'Welcome to the channel!');
  });

controller.on('member_left_channel', function(bot, message) {
    bot.reply(message,'cya.... sucker.');
  });

controller.hears(['list', 'members'], 'direct_mention', function(bot, message) {
    bot.reply(message, 'you\'ve asked to list the channel members');
    bot.reply(message, "for channel: " + message.channel);
    bot.reply(message, "who said that: " + message.user);
    

    bot.api.channels.info({
        channel: message.channel
    }, function (err, results) {
        if (results.ok && results.ok === true) {


            bot.reply(message, "results: " + results);
            bot.reply(message, "channel: " + results.channel);
            bot.reply(message, "members: " + results.channel.members);
            
            var members = results.channel.members;
            for (var index = 0; index < members.length; index++) {
                var member = members[index];

                 bot.startPrivateConversation({
                    user: member
                }, function (err, convo) {
                    if (!err && convo) {
                        convo.say('Hello there! I messaged you because you were in the channel #' + results.channel.name);
                    }
                });
            }
        }
    });  
  });
