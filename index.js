/**
 * A Bot for Slack!
 * 
 * Foreman is installed, start by typing 'nf start' in folder
 * Uses environment vars defined in .env
 */

//region boilerplate
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
    setInterval(function() {
        checkTimesAndReport(bot);
    }, 60000);
});

controller.on('rtm_close', function (bot) {
    console.log('** The RTM api just closed');
    // you may want to attempt to re-open
});
//endregion

/**
 * Core bot logic goes here!
 */

//region getters / setters of times and reports
function setStandupTime(channel, standupTimeToSet) {
    
    controller.storage.teams.get('standupTimes', function(err, standupTimes) {

        if (!standupTimes) {
            standupTimes = {};
            standupTimes.id = 'standupTimes';
        }

        standupTimes[channel] = standupTimeToSet;
        controller.storage.teams.save(standupTimes);
    });
}

function getStandupTime(channel, cb) {
    controller.storage.teams.get('standupTimes', function(err, standupTimes) {
        if (!standupTimes || !standupTimes[channel]) {
            cb(null, null);
        } else {
            cb(null, standupTimes[channel]);
        }
    });
}

function getStandupTimes(cb) {
    controller.storage.teams.get('standupTimes', function(err, standupTimes) {
        if (!standupTimes) { 
            cb(null, null);
        } else {
            cb(null, standupTimes);
        }
    });
}

function addStandupData(standupReport) {
    
    controller.storage.teams.get('standupData', function(err, standupData) {
        
        if (!standupData) {
            standupData = {};
            standupData.id = 'standupData';
        }
    
        if (!standupData[standupReport.channel]) {
            standupData[standupReport.channel] = {};
        }
    
        standupData[standupReport.channel][standupReport.user] = standupReport;
        controller.storage.teams.save(standupData);
    });
}

function getStandupData(channel, cb) {
    controller.storage.teams.get('standupData', function(err, standupData) {
        if (!standupData || !standupData[channel]) {
            cb(null, null);
        } else {
            cb(null, standupData[channel]);
        }
    });
}

function clearStandupData(channel) {
    controller.storage.teams.get('standupData', function(err, standupData) {
        if (!standupData || !standupData[channel]) {
            return;
        } else {
            delete standupData[channel];
            controller.storage.teams.save(standupData);
        }
    });
}
//endregion

//region functions to do with the times

// Informs the channel when the standup report will be generated
controller.hears('when', 'direct_mention', function(bot, message) {
    getChannelName(bot, message.channel, function(err, channelName) {
        if (!err) {           
            getStandupTime(message.channel, function(err, standuptime) {
                if (!standuptime) {
                    bot.reply(message, 'A standup time has not been set for #' + channelName);
                } else {
                    bot.reply(message, "Standup reporting time for #" + channelName + " is " + standuptime.hours + ":" + standuptime.minutes);
                }    
            });
        }
    });
});

// Cancels the standup report by nulling the time for this channel
controller.hears('cancel', 'direct_mention', function(bot, message) {
    setStandupTime(message.channel, null);
    bot.reply(message, 'Standup report has been cancelled for this channel. Please \'settime\' again to resume.');
});

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
                    
                    setStandupTime(message.channel, standupTimeToSet);

                    convo.say('Standup reporting time has been changed to `' + standupTimeToSet.hours + ':' + standupTimeToSet.minutes + '`.');
                    bot.say({
                        channel: message.channel,
                        text: '*Attention*: standup reporting time has been changed to `' + standupTimeToSet.hours + ':' + standupTimeToSet.minutes + '`.',
                        mrkdwn: true
                    });            
                } else {
                    convo.say('Error reading the entered time, standup time not set.');
                    convo.say('You said: ' + response.text);
                    convo.repeat();
                }

                convo.next();
            });

        }
    });
});

function getHoursAndMinutesFromResponse(responseText) {

    if (responseText.length != 5) { return null; }

    let hoursInt = parseInt(responseText);
    let minutesInt = parseInt(responseText.substring(3,5));

    if (!hoursInt || hoursInt <= 0 || hoursInt > 23) { return null; }
    if (!minutesInt || minutesInt < 0 || minutesInt > 59 ) { return null; }
    return { hours: hoursInt, minutes: minutesInt };
}
//endregion

//region functions to do with collecting and displaying standup reports

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
                            text: "*" + standupReport.userName + "* did their standup at " + standupReport.datetime,
                            //text: displaySingleReport(bot, standupReport),
                            mrkdwn: true
                        });

                        addStandupData(standupReport);
                    });
                }
            });
        }
    });
});

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

// generates the standup report on command, will not destroy reported standups
controller.hears('trigger', 'direct_mention', function(bot, message) {
    getStandupData(message.channel, function(err, standupReports) {
        bot.say({
            channel: message.channel,
            text: getReportDisplay(standupReports),
            mrkdwn: true
        });
    });
});

// when the time to report is hit, report the standup, clear the standup data for that channel
function checkTimesAndReport(bot) {
    getStandupTimes(function(err, standupTimes) { 
        if (!standupTimes) {
            return;
        }
        var currentHoursAndMinutes = getCurrentHoursAndMinutes();
        for (var channelId in standupTimes) {
            var standupTime = standupTimes[channelId];
            if (compareHoursAndMinutes(currentHoursAndMinutes, standupTime)) {
                getStandupData(channelId, function(err, standupReports) {
                    bot.say({
                        channel: channelId,
                        text: getReportDisplay(standupReports),
                        mrkdwn: true
                    });
                    clearStandupData(channelId);
                });
            }
        }
    });
}

function getCurrentHoursAndMinutes() {
    var now = new Date();
    return { hours: now.getHours(), minutes: now.getMinutes() };
}

function compareHoursAndMinutes(t1, t2) {
    return (t1.hours === t2.hours) && (t1.minutes === t2.minutes);
}

// given the collection of standup reports, collates the entire report
function getReportDisplay(standupReports) {
    
    if (!standupReports) {
        return "*There is no standup data to report.*";
    }

    var totalReport = "*Standup Report*\n\n";
    for (var user in standupReports) {
        var report = standupReports[user];
        totalReport += getSingleReportDisplay(report);
    }
    return totalReport;
}

// builds a string that displays a single user's standup report
function getSingleReportDisplay(standupReport) {
    var report = "*" + standupReport.userName + "* did their standup at " + standupReport.datetime + "\n";
    report += "_What did you work on yesterday:_ `" + standupReport.yesterdayQuestion + "`\n";
    report += "_What are you working on today:_ `" + standupReport.todayQuestion + "`\n";
    report += "_Any obstacles:_ `" + standupReport.obstacleQuestion + "`\n\n";
    return report;
}
//endregion


/**
 * sends a help msg in a private convo informing the user how to use this bot
 * 
 * settime
 * when
 * cancel
 * 
 * standup
 * trigger
 * 
 */
controller.hears('help', 'direct_mention', function(bot, message) {
    bot.startPrivateConversation({
        user: message.user
    }, function(err, convo) {
        if (!err && convo) {
            convo.say({
                text: getHelpMessage(),
                mrkdwn: true
            });
        }
    })
});

function getHelpMessage() {
    var helpMsg = "";
    helpMsg += "*icosStandupBot*: written by J.T. Dorion\n";
    helpMsg += "_intended mode of use_: use the `settime` command to set a report time, each team member use the `standup` command to do their daily standup report at their convenience.\n\n"; 
    helpMsg += "_note_: the normal report that happens at a specific time also clears the standup data after reporting, while the `trigger` command does not.\n\n"
    helpMsg += "*commands about when the standup report will be generated* \n";
    helpMsg += "_@icosStandupBot settime_: `sets the time that the report will be generated. done in a private convo.`\n";
    helpMsg += "_@icosStandupBot when_: ` informs the channel when the report will be generated`\n";
    helpMsg += "_@icosStandupBot cancel_: `cancels report generation`\n\n";
    helpMsg += "*commands about collecting and reporting standup data* \n";
    helpMsg += "_@icosStandupBot standup_: `bot will ask the standup questions in a private convo`\n";
    helpMsg += "_@icosStandupBot trigger_: `reports the standup immediately`\n";
    return helpMsg;    
}

//region rando fun
function getChannelName(bot, channel, cb) {
    bot.api.channels.info({ channel: channel }, function (err, results) {
        if (results.ok && results.ok === true) {
            cb(null, results.channel.name);
        }
    });      
}

function getUserName(bot, userId, cb) {
    bot.api.users.info({ user: userId }, function(err, results) {
        if (results.ok && results.ok === true) {
            cb(null, results.user.name);
        }
    });
}

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

controller.hears('dickhead', 'ambient', function(bot, message) {
    bot.reply(message, 'Be nice, Andrew.');
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
//endregion