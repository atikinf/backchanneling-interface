// Based in part on a lot of Kurento tutorials

const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
var kurento = require('kurento-client');
var minimist = require('minimist');

app.use(express.static('public'));
app.use('/scripts', express.static(__dirname + '/node_modules'));

// variables
var kurentoClient = null;
var userRegistry = new UserRegistry();
var pipelines = {};
var candidatesQueue = {};
var idCounter = 0;

function nextUniqueId() {
    idCounter++;
    return idCounter.toString();
}


var argv = minimist(process.argv.slice(2), {
    default: {
        as_uri: 'http://localhost:3000/',
        ws_uri: 'ws://localhost:8888/kurento'
    }
});

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
    this.webRtcEndpoint = {};
}

CallMediaPipeline.prototype.createPipeline = function(callerId, calleeId, callback) {
    var self = this;
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

                    callerWebRtcEndpoint.connect(calleeWebRtcEndpoint, function(error) {
                        if (error) {
                            pipeline.release();
                            return callback(error);
                        }

                        calleeWebRtcEndpoint.connect(callerWebRtcEndpoint, function(error) {
                            if (error) {
                                pipeline.release();
                                return callback(error);
                            }
                        });

                        self.pipeline = pipeline;
                        self.webRtcEndpoint[callerId] = callerWebRtcEndpoint;
                        self.webRtcEndpoint[calleeId] = calleeWebRtcEndpoint;
                        callback(null);
                    });
                });
            });
        });
    })
}

CallMediaPipeline.prototype.generateSdpAnswer = function(id, sdpOffer, callback) {
    this.webRtcEndpoint[id].processOffer(sdpOffer, callback);
    this.webRtcEndpoint[id].gatherCandidates(function(error) {
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
        // clean up deleted user
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

            // Register a new user (i.e. a client)
            const userid = nextUniqueId();
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

    // Re-broadcasters
    
    // both clients are in the room, start call
    socket.on('ready', room => {
        socket.broadcast.to(room).emit('ready');
    });

    // Store a client's generated SDP offer and connect the call if both clients 
    // are ready
    socket.on('offer', event => {
        console.log('Processing an SDP offer from', event.userid);
        userRegistry.getById(event.userid).sdpOffer = event.sdpOffer;

        if (userRegistry.getByRoom(event.room).length > 1) {
            // Pass in the second client's socket
            startCall(event.room, socket);
        }
        // socket.broadcast.to(event.room).emit('offer', event);
    });

    // broadcast an ice candidate to the other client
    socket.on('candidate', event => {
        console.log('Processing an ICE candidate from', event.userid);
        onIceCandidate(event.userid, event.candidate);
        // socket.broadcast.to(event.room).emit('candidate', event);
    });
    
    // Recording stuff, broadcasted to all clients
    socket.on('recording', room => {
        socket.to(room).emit('recording', room);
    });

    socket.on('stop recording', room => {
        socket.to(room).emit('stop recording', room);
    });
});

// When both clients have joined a room, and they have both emitted SDP offers
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

        console.log("Yahoo");
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
                    });
            });
    });
}

function clearCandidatesQueue(sessionId) {
    if (candidatesQueue[sessionId]) {
        delete candidatesQueue[sessionId];
    }
}

// Store an ICE candidate sent to us by a client
function onIceCandidate(userid, _candidate) {
    var candidate = kurento.getComplexType('IceCandidate')(_candidate);
    var user = userRegistry.getById(userid);

    if (pipelines[user.id] && pipelines[user.userid].webRtcEndpoint && pipelines[user.id].webRtcEndpoint[user.id]) {
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

