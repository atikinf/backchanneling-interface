// Based in part on a lot of Kurento tutorials

const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
var kurento = require('kurento-client');
var minimist = require('minimist');

app.use(express.static('public'));
app.use('/node_scripts', express.static(__dirname + '/node_modules'));
app.use('/bower_scripts', express.static(__dirname + '/bower_components'));

// variables
var kurentoClient = null;
var userRegistry = new UserRegistry();
var pipelines = {};
var candidatesQueue = {};
var idCounter = 0;
var recordingCounter = 0;

function nextUniqueUserId() {
    idCounter++;
    return idCounter.toString();
}

function nextUniqueRecordingId() {
    recordingCounter++;
    return recordingCounter.toString();
}

// URI args, to set an arg in the command line, add --as_uri="..." for your command for example
var argv = minimist(process.argv.slice(2), {
    default: {
        as_uri: 'http://localhost:3000/',
        ws_uri: 'http://localhost:8888/kurento',
        recording_dir_uri: 'file:///tmp/', // directory where recordings are stored
    }
});

console.log('KMS server at', argv.ws_uri);

// Represents client sessions
function UserSession(userid, room, socket) {
    this.userid = userid;
    this.room = room;
    this.socket = socket;
    this.sdpOffer = null;
}

// Represents registrar of users
function UserRegistry() {
    this.usersById = {};
    this.usersByName = {};
    this.usersBySocketId = {};
    this.usersByRoom = {};
}

UserRegistry.prototype.register = function(user) {
    this.usersById[user.userid] = user;
    this.usersByName[user.name] = user;
    this.usersBySocketId[user.socket.id] = user;
    this.usersByRoom[user.room] = this.usersByRoom[user.room] || [];
    this.usersByRoom[user.room].push(user);
}

UserRegistry.prototype.unregister = function(id) {
    var user = this.getById(id);
    if (user) delete this.usersById[id]
    if (user && this.getByName(user.name)) delete this.usersByName[user.name];
    if (user && this.getBySocketId(user.socket.id)) {
        delete this.usersBySocketId[user.socket.id];
    }
    if (user && this.getByRoom(user.room).length) {
        var i;
        for (i = 0; i < this.usersByRoom[user.room].length; i++) {
            if (this.usersByRoom[user.room][i].userid == id) {
                delete this.usersByRoom[user.room][i];
                break;
            }
        }
    }
}

UserRegistry.prototype.getById = function(id) {
    return this.usersById[id];
}

UserRegistry.prototype.getByName = function(name) {
    return this.usersByName[name];
}

UserRegistry.prototype.getBySocketId = function(name) {
    return this.usersBySocketId[name];
}

UserRegistry.prototype.getByRoom = function(room) {
    return this.usersByRoom[room] || [];
}

UserRegistry.prototype.removeById = function(id) {
    var userSession = this.usersById[id];
    if (!userSession) return;
    delete this.usersById[id];
    delete this.usersByName[userSession.name];
    delete this.usersBySocketId[userSession.socket.id];
    var i;
    for (i = 0; i < this.usersByRoom[userSession.room].length; i++) {
        if (this.usersByRoom[userSession.room][i].userid == id) {
            this.usersByRoom[userSession.room].splice(i, 1);
            break;
        }
    }
}

// Represents an active call
function CallMediaPipeline() {
    this.pipeline = null;
    this.webRtcEndpoints = {};
    this.recorderEndpoints = {};
}

CallMediaPipeline.prototype.createPipeline = function(callerId, calleeId, callback) {
    var self = this;

    const recording_dir = argv.recording_dir_uri + 'session_' + nextUniqueRecordingId() + '/';


    getKurentoClient(function(error, kurentoClient) {
        if (error) {
            return callback(error);
        }

        kurentoClient.create('MediaPipeline', function(error, pipeline) {
            if (error) {
                return callback(error);
            }

            pipeline.create('WebRtcEndpoint', function(error, callerWebRtcEndpoint) {
                if (error) {
                    pipeline.release();
                    return callback(error);
                }

                if (candidatesQueue[callerId]) {
                    while(candidatesQueue[callerId].length) {
                        var candidate = candidatesQueue[callerId].shift();
                        callerWebRtcEndpoint.addIceCandidate(candidate);
                    }
                }

                callerWebRtcEndpoint.on('OnIceCandidate', function(event) {
                    var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
                    userRegistry.getById(callerId).socket.emit('candidate', {
                        candidate: candidate,
                    });
                });

                pipeline.create('WebRtcEndpoint', function(error, calleeWebRtcEndpoint) {
                    if (error) {
                        pipeline.release();
                        return callback(error);
                    }

                    if (candidatesQueue[calleeId]) {
                        while(candidatesQueue[calleeId].length) {
                            var candidate = candidatesQueue[calleeId].shift();
                            calleeWebRtcEndpoint.addIceCandidate(candidate);
                        }
                    }

                    calleeWebRtcEndpoint.on('OnIceCandidate', function(event) {
                        var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
                        userRegistry.getById(calleeId).socket.emit('candidate', {
                            candidate: candidate,
                        });
                    });

                    let recordingParams = { 
                        uri: recording_dir + 'recording_' + callerId + '.mp4', 
                        stopOnEndOfStream: true, 
                        mediaProfile: 'MP4',
                    }

                    pipeline.create('RecorderEndpoint', recordingParams, function(error, callerRecorderEndpoint) {
                        if (error) {
                            pipeline.release();
                            return callback(error);
                        }

                        recordingParams = { 
                            uri: recording_dir + 'recording_' + calleeId + '.mp4', 
                            stopOnEndOfStream: true, 
                            mediaProfile: 'MP4',
                        }

                        pipeline.create('RecorderEndpoint', recordingParams, function(error, calleeRecorderEndpoint) {
                            if (error) {
                                pipeline.release();
                                return callback(error);
                            }
                            
                            callerWebRtcEndpoint.connect(calleeWebRtcEndpoint, function(err) {
                                if (err) {
                                    pipeline.release();
                                    return callback(err);
                                }
            
                                calleeWebRtcEndpoint.connect(callerWebRtcEndpoint, function(err) {
                                    if (err) {
                                        pipeline.release();
                                        return callback(err);
                                    }
            
                                    callerWebRtcEndpoint.connect(callerRecorderEndpoint, function(err) {
                                        if (err) {
                                            pipeline.release();
                                            return callback(err);
                                        }
            
                                        calleeWebRtcEndpoint.connect(calleeRecorderEndpoint, function(err) {
                                            if (err) {
                                                pipeline.release();
                                                return callback(err);
                                            }
                
                                            self.pipeline = pipeline;
                                            self.webRtcEndpoints[callerId] = callerWebRtcEndpoint;
                                            self.webRtcEndpoints[calleeId] = calleeWebRtcEndpoint;
                                            self.recorderEndpoints[callerId] = callerRecorderEndpoint;
                                            self.recorderEndpoints[calleeId] = calleeRecorderEndpoint;
                                            callback(null);                     
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    })
}

CallMediaPipeline.prototype.generateSdpAnswer = function(id, sdpOffer, callback) {
    console.log('Processing SDP offer from', id);
    this.webRtcEndpoints[id].processOffer(sdpOffer, callback);
    this.webRtcEndpoints[id].gatherCandidates(function(error) {
        if (error) {
            return callback(error);
        }
    });
}

CallMediaPipeline.prototype.release = function() {
    if (this.pipeline) this.pipeline.release();
    this.pipeline = null;
}


// Signaling handlers

io.on('connection', socket => {
    console.log('a user connected');

    socket.on('disconnect', () => {
        console.log('a user disconnected');
        // Clean up deleted user
        let userSession = userRegistry.getBySocketId(socket.id);
        if (userSession) {
            userRegistry.removeById(userSession.userid);

            let remainingUsers = userRegistry.getByRoom(userSession.room).length;
            console.log('Room', userSession.room, 'now has', 
                        remainingUsers, 'clients');
        }
        socket.disconnect();
    });

    socket.on('join', roomNumber => {
        let room = io.sockets.adapter.rooms[roomNumber] || { length: 0 };
        let numClients = room.length;
        
        if (numClients > 1) {
            socket.emit('full', roomNumber);
        } else {
            socket.join(roomNumber);

            // Register a new user
            const userid = nextUniqueUserId();
            userRegistry.register(new UserSession(userid, 
                                                  roomNumber, 
                                                  socket));

            socket.emit('joined', {
                room: roomNumber,
                userid: userid,
                numClients: numClients + 1 // to account for this new client
            });

            console.log('Room', roomNumber, 'now has', numClients + 1, 'clients');   
        }
    });

    // Store a client's generated SDP offer and connect the call if both clients 
    // are ready
    socket.on('offer', event => {
        console.log('Got an SDP offer from', event.userid);
        userRegistry.getById(event.userid).sdpOffer = event.sdpOffer;

        if (userRegistry.getByRoom(event.room).length > 1) {
            // Pass in the second client's socket
            startCall(event.room, socket);
        }
    });

    // broadcast an ice candidate to the other client
    socket.on('candidate', event => {
        onIceCandidate(event.userid, event.candidate);
    });
 
    // both clients are in the room, currently does nothing
    socket.on('ready', room => {
        socket.broadcast.to(room).emit('ready');
    });
    
    // Recording stuff, broadcasted to all clients
    socket.on('start recording', event => {
        startRecording(event.room, event.userid);
    });

    socket.on('stop recording', event => {
        socket.broadcast.to(event.room).emit('recording stopped', event.room);
        stopRecording(event.room, event.userid);
    });
});

// Builds a media pipeline with the appropriate endpoints and completes 
// peer negotiation with both clients 
function startCall(roomNumber, socket) {
    clearCandidatesQueue();

    var pipeline = new CallMediaPipeline();

    // For the sake of readability, we'll have a caller a callee despite
    // no caller literally initiating a call with a callee
    let users = userRegistry.getByRoom(roomNumber);
    if (users.length < 2) {
        return console.error('There are only', users.length, 'users in room', roomNumber);
    }
    let caller = users[0];
    let callee = users[1];


    pipelines[caller.userid] = pipeline;
    pipelines[callee.userid] = pipeline;

    pipeline.createPipeline(caller.userid, callee.userid, function(err) { 
        if (err) {
            return console.log(err);
        }

        pipeline.generateSdpAnswer(caller.userid, caller.sdpOffer, 
            function(err, callerSdpAnswer) {
                if (err) {
                    return console.log(err);
                }

                pipeline.generateSdpAnswer(callee.userid, callee.sdpOffer,
                    function(err, calleeSdpAnswer) {
                        if (err) {
                            return console.log(err);
                        }
                        
                        callee.socket.emit('answer', {
                            sdpOffer: calleeSdpAnswer,
                        });

                        caller.socket.emit('answer', {
                            sdpOffer: callerSdpAnswer,
                        });

                        socket.broadcast.emit('ready');
                    });
            });
    });
}

function clearCandidatesQueue(sessionId) {
    if (candidatesQueue[sessionId]) {
        delete candidatesQueue[sessionId];
    }
}

function startRecording(room, userid) {
    console.log('Starting a recording');
    const userA = userRegistry.getByRoom(room)[0];
    const userB = userRegistry.getByRoom(room)[1];

    // Socket of user that requested start recording
    const socket = userRegistry.getById(userid).socket;

    // Check there aren't any missing recording elements in the pipeline
    if (pipelines[userA.userid] 
        && pipelines[userA.userid].recorderEndpoints 
        && pipelines[userA.userid].recorderEndpoints[userA.userid]) {

        pipelines[userA.userid].recorderEndpoints[userA.userid].record(function(err) {
            if (err) return console.log(err);
            userA.socket.to(room).emit('recording successful');
        });
    } else {
        socket.emit('recording error');
    }

    if (pipelines[userB.userid] 
        && pipelines[userB.userid].recorderEndpoints 
        && pipelines[userB.userid].recorderEndpoints[userB.userid]) {

        pipelines[userB.userid].recorderEndpoints[userB.userid].record(function(err) {  
            if (err) return console.log(err);
            socket.to(room).emit('recording started');
        });
    } else {
        socket.emit('recording error');
    }
}

function stopRecording(room, userid) {
    console.log('Stopping recording...');
    const userA = userRegistry.getByRoom(room)[0];
    const userB = userRegistry.getByRoom(room)[1];

    // Socket of user that requested start recording
    const socket = userRegistry.getById(userid).socket;

    // Check there aren't any missing recording elements in the pipeline
    if (pipelines[userA.userid] 
        && pipelines[userA.userid].recorderEndpoints 
        && pipelines[userA.userid].recorderEndpoints[userA.userid]) {

        // Stop recording and wait until the files are written
        pipelines[userA.userid].recorderEndpoints[userA.userid].stopAndWait(function(err) {
            if (err) return console.log(err);

            if (pipelines[userB.userid] 
                && pipelines[userB.userid].recorderEndpoints 
                && pipelines[userB.userid].recorderEndpoints[userB.userid]) {
        
                // Stop recording and wait until the files are written
                pipelines[userB.userid].recorderEndpoints[userB.userid].stopAndWait(function(err) {
                    if (err) return console.log(err);
        
                    socket.emit('recording finished');
                });
            } else {
                socket.emit('recording error');
            }
        });
    } else {
        socket.emit('recording error');
    }
}

// ToDo: Finish implementation
// As you cannot update RecorderEndpoint URIs after their creation,
// this function is intended to simply create new endpoints and do all the 
// necessary configuration
function updateRecorderUris(callMediaPipeline) {
    const recording_dir = argv.recording_dir_uri + 'session_' + nextUniqueRecordingId() + '/';    

    pipeline = callMediaPipeline.pipeline;

    const elements = [
        {type: 'RecorderEndpoint', params: {uri: argv.recording_dir_uri + 'recording_' + callerId + '.webm'}},
        {type: 'RecorderEndpoint', params: {uri: argv.recording_dir_uri + 'recording_' + calleeId + '.webm'}},
    ];

    pipeline.create(elements, function(err, elements) {
        if (err) {
            pipeline.release();
            return console.log(err);
        }

        const callerRecorderEndpoint = elements[0];
        const calleeRecorderEndpoint = elements[1];

        // calleeRec
    });
}

// Store an ICE candidate sent to us by a client
function onIceCandidate(userid, _candidate) {
    var candidate = kurento.getComplexType('IceCandidate')(_candidate);
    var user = userRegistry.getById(userid);

    if (pipelines[user.id] 
        && pipelines[user.userid].webRtcEndpoint 
        && pipelines[user.id].webRtcEndpoint[user.id]) {

        var webRtcEndpoint = pipelines[user.userid].webRtcEndpoint[user.userid];
        webRtcEndpoint.addIceCandidate(candidate);
    }
    else {
        if (!candidatesQueue[user.userid]) {
            candidatesQueue[user.userid] = [];
        }
        candidatesQueue[userid].push(candidate);
    }
}

function getKurentoClient(callback) {
    if (kurentoClient !== null) {
        return callback(null, kurentoClient);
    }

    kurento(argv.ws_uri, function (error, _kurentoClient) {
        if (error) {
            console.log("Could not find media server at address " + argv.ws_uri);
            return callback("Could not find media server at address" + argv.ws_uri
                + ". Exiting with error " + error);
        }

        kurentoClient = _kurentoClient;
        callback(null, kurentoClient);
    });
}


// listener
http.listen(3000, () => {
    console.log('listening on *:3000');
})

