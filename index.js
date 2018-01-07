/**
 * A Bot for Slack!
 * 
 * Foreman is installed, start by typing 'nf start' in folder
 * Uses environment vars defined in .env or .vscode/launch.json
 * run this locally first: 'pagekite.py 8765 jdorion.pagekite.me'
 * 
 */

//#region boilerplate / intialization
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
    setInterval(function() {
        checkTimesAndAskStandup(bot);
    }, 60000);
});

controller.on('rtm_close', function (bot) {
    console.log('** The RTM api just closed');
    // you may want to attempt to re-open
});
//#endregion

/**
 * Core bot logic goes here!
 */


//#region getters / setters of times and reports

// sets the time that the standup report will be generated for a channel
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

function cancelStandupTime(channel) {
    controller.storage.teams.get('standupTimes', function(err, standupTimes) {

        if (!standupTimes || !standupTimes[channel]) {
            return;
        } else {
            delete standupTimes[channel];
            controller.storage.teams.save(standupTimes);            
        }
    });       
}

// gets the time that the standup report will be generated for a channel
function getStandupTime(channel, cb) {
    controller.storage.teams.get('standupTimes', function(err, standupTimes) {
        if (!standupTimes || !standupTimes[channel]) {
            cb(null, null);
        } else {
            cb(null, standupTimes[channel]);
        }
    });
}

// gets all the times that standup reports will be generated for all channels
function getStandupTimes(cb) {
    controller.storage.teams.get('standupTimes', function(err, standupTimes) {
        if (!standupTimes) { 
            cb(null, null);
        } else {
            cb(null, standupTimes);
        }
    });
}

// gets all the times users would like to be asked to report for all channels
function getAskingTimes(cb) {
    controller.storage.teams.get('askingtimes', function(err, askingTimes) {

        if (!askingTimes) {
            cb(null, null);
        } else {
            cb(null, askingTimes);
        }
    });
}

// gets the time a user has asked to report for a given channel
function getAskingTime(user, channel, cb) {
    controller.storage.teams.get('askingtimes', function(err, askingTimes) {

        if (!askingTimes || !askingTimes[channel] || !askingTimes[channel][user]) {
            cb(null,null);
        } else {
            cb(null, askingTimes[channel][user]);          
        }
    });     
}

// records when a user would like to be asked to report for a channel
function addAskingTime(user, channel, timeToSet) {
    controller.storage.teams.get('askingtimes', function(err, askingTimes) {

        if (!askingTimes) {
            askingTimes = {};
            askingTimes.id = 'askingtimes';
        }

        if (!askingTimes[channel]) {
            askingTimes[channel] = {};
        }

        askingTimes[channel][user] = timeToSet;
        controller.storage.teams.save(askingTimes);
    });
}

// cancels a user's asking time in a channel
function cancelAskingTime(user, channel) {
    controller.storage.teams.get('askingtimes', function(err, askingTimes) {

        if (!askingTimes || !askingTimes[channel] || !askingTimes[channel][user]) {
            return;
        } else {
            delete askingTimes[channel][user];
            controller.storage.teams.save(askingTimes);            
        }
    });   
}

// adds a user's standup report to the standup data for a channel
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

// gets all standup data for a channel
function getStandupData(channel, cb) {
    controller.storage.teams.get('standupData', function(err, standupData) {
        if (!standupData || !standupData[channel]) {
            cb(null, null);
        } else {
            cb(null, standupData[channel]);
        }
    });
}

// clears all standup reports for a channel
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

// returns true (in a callback) if the specified user has a standup report saved
function hasStandup(who, cb) {
    
    var user = who.user;
    var channel = who.channel;
    controller.storage.teams.get('standupData', function(err, standupData) {
        if (!standupData || !standupData[channel] || !standupData[channel][user]) {
            cb(null, false);
        } else {
            cb(null, true);
        }
    });
}

//#endregion

//#region functions to do with the standup reporting time

// Informs the channel when the standup report will be generated
controller.hears('whenreport', 'direct_mention', function(bot, message) {
    getChannelName(bot, message.channel, function(err, channelName) {
        if (!err) {           
            getStandupTime(message.channel, function(err1, standuptime) {
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
controller.hears('cancelreport', 'direct_mention', function(bot, message) {
    cancelStandupTime(message.channel);
    bot.reply(message, 'Standup report has been cancelled for this channel. Please \'setreporttime\' again to resume.');
});

// set the report time
controller.hears('setreporttime', 'direct_mention', function(bot, message) {

    bot.startPrivateConversation({
        user: message.user
    }, function(err, convo) {
        if (!err && convo) {
            convo.ask('What time would you like to generate the standup report? (hh:mm, in 24h time)\n\n If the hours is less than 10, include a leading zero. eg. 09:45, not 9:45.', function(response, convo) {
                
                var standupTimeToSet = null;
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

    var hoursInt = parseInt(responseText);
    var minutesInt = parseInt(responseText.substring(3,5));

    if (!hoursInt || hoursInt <= 0 || hoursInt > 23) { return null; }
    if (!minutesInt || minutesInt < 0 || minutesInt > 59 ) { return null; }
    return { hours: hoursInt, minutes: minutesInt };
}
//#endregion

//#region functions to do with the standup asking time

// informs the user when they will be asked to do their standup
controller.hears('when', 'direct_mention', function(bot, message) {

    getChannelName(bot, message.channel, function(err, channelName) {
        if (!err) {
            getAskingTime(message.user, message.channel, function(err1, askingTime) {
                getUserName(bot, message.user, function(err2, username) {
                    if (!err1 && !err2) {
                        if (!askingTime) {
                            bot.reply(message, username + ', you have not set an automatic standup for #' + channelName);
                        } else {
                            bot.reply(message, username + ", your automatic standup time for #" + channelName + " is " + askingTime.hours + ":" + askingTime.minutes);
                        }
                    }  
                });  
            });
        }
    });
});

// cancels the automatic asking to do their standup
controller.hears('cancel', 'direct_mention', function(bot, message) {
    cancelAskingTime(message.user, message.channel);
    getUserName(bot, message.user, function(err, username) {
        bot.reply(message, username + ', you have cancelled your automatic standup. Please \'set\' again to resume, or \'standup\' to report manually.');
    });
});

// sets when they will be asked to do their standup
controller.hears('set', 'direct_mention', function(bot, message) {

    bot.startPrivateConversation({
        user: message.user
    }, function(err, convo) {
        if (!err && convo) {
            convo.ask('What time would you like to do your standup? (hh:mm, in 24h time)\n\n If the hours is less than 10, include a leading zero. eg. 09:45, not 9:45.', function(response, convo) {
                
                var askingTimeToSet = null;
                askingTimeToSet = getHoursAndMinutesFromResponse(response.text);

                if (askingTimeToSet) {
                    addAskingTime(message.user, message.channel, askingTimeToSet);
                    convo.say('Your personal standup time has been changed to `' + askingTimeToSet.hours + ':' + askingTimeToSet.minutes + '`.');          
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

//#endregion

//#region functions to do with collecting and displaying standup reports

// when someone @-mentions the bot and says standup, start a convo and save the results (per channel, in case of multiples)
controller.hears('standup', 'direct_mention', function(bot, message) {
    doStandup(bot, message.user, message.channel);
});

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

// intended to be called every minute. checks if there exists a user that has requested to be asked to give 
// a standup report at this time, then asks them
function checkTimesAndAskStandup(bot) {
    getAskingTimes(function (err, askMeTimes) {
        
        if (!askMeTimes) {
            return;
        }

        for (var channelId in askMeTimes) {

            for (var userId in askMeTimes[channelId]) {

                var askMeTime = askMeTimes[channelId][userId];
                var currentHoursAndMinutes = getCurrentHoursAndMinutes();
                if (compareHoursAndMinutes(currentHoursAndMinutes, askMeTime)) {

                    hasStandup({user: userId, channel: channelId}, function(err, hasStandup) {

                        // if the user has not set an 'ask me time' or has already reported a standup, don't ask again
                        if (hasStandup == null || hasStandup == true) {
                            var x = "";
                        } else {
                            doStandup(bot, userId, channelId);
                        }
                    });
                }
            }
        }
    });
}

// will initiate a private conversation with user and save the resulting standup report for the channel
function doStandup(bot, user, channel) {

    var userName = null;

    getUserName(bot, user, function(err, name) {
        if (!err && name) {
            userName = name;

            bot.startPrivateConversation({
                user: user
            }, function(err, convo) {
                if (!err && convo) {
                    var standupReport = 
                    {
                        channel: channel,
                        user: user,
                        userName: userName,
                        datetime: getCurrentOttawaDateTimeString(),
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
}

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

// returns an object (not date) with the current hours and minutes, Ottawa time
function getCurrentHoursAndMinutes() {
    var now = convertUTCtoOttawa(new Date());
    return { hours: now.getHours(), minutes: now.getMinutes() };
}

// compares two objects (not date) with hours and minutes
function compareHoursAndMinutes(t1, t2) {
    return (t1.hours === t2.hours) && (t1.minutes === t2.minutes);
}

// if the given date is in UTC, converts it to Ottawa time.
// this is a 'reasonable' hack since the only two places that the js will be run will be on azure (UTC),
// and locally (Ottawa time)
function convertUTCtoOttawa(date) {
    
    var d = new Date();
    if (d.getHours() === d.getUTCHours()) {
        d.setUTCHours(d.getUTCHours() - 5);
    }

    return d;
}

// returns a formatted string of the current datetime in Ottawa time
function getCurrentOttawaDateTimeString() {

    var date = convertUTCtoOttawa(new Date());

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
//#endregion


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
    helpMsg += "_note_: the normal report that happens at a specific time also clears the standup data after reporting, while the `trigger` command does not.\n\n"
    helpMsg += "*commands about when the standup report will be generated* \n";
    helpMsg += "_@icosstandupbot whenreport_: ` informs the channel when the report will be generated`\n";
    helpMsg += "_@icosstandupbot cancelreport_: `cancels report generation`\n";
    helpMsg += "_@icosstandupbot setreporttime_: `sets the time that the report will be generated. done in a private convo.`\n\n";
    helpMsg += "*commands about having the bot ask you automatically to do your standup*\n";
    helpMsg += "_@icosstandupbot when_: `informs you when you've set the automatic standup`\n";
    helpMsg += "_@icosstandupbot set_: `sets the time that the bot will ask you to do your standup`\n";
    helpMsg += "_@icosstandupbot cancel_: `stops the bot from automatically asking you to do your standup`\n\n";
    helpMsg += "*commands about collecting and reporting standup data* \n";
    helpMsg += "_@icosstandupbot standup_: `bot will ask the standup questions in a private convo`\n";
    helpMsg += "_@icosstandupbot trigger_: `reports the standup immediately`\n";
    return helpMsg;    
}

//#region rando fun
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

controller.hears('ping', 'direct_mention', function(bot, message) {
    bot.reply(message, 'pong');
});

controller.on('bot_channel_join', function (bot, message) {
    bot.reply(message, "I'm here!")
});

//#endregion