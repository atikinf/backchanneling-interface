// TODO: rtcPeerConnection.addStream() is deprecated

// Based in part on https://webrtc.ventures/2018/07/tutorial-build-video-conference-application-webrtc-2/

// DOM elements
const joinRoomButton = document.getElementById('join-room-button');
const roomNumberInput = document.getElementById('room-number-input');
const yourVideo  = document.getElementById('your-video');
const friendsVideo = document.getElementById('friends-video');
const overlayContainer = document.getElementById('overlay-container');

const startRecording = document.getElementById('btn-start-recording');
const stopRecording = document.getElementById('btn-stop-recording');
const downloadRecording = document.getElementById('btn-download-recording');
const recordingBlockElements = document.getElementsByClassName('recording-block');
const downloadBlockElements = document.getElementsByClassName('download-block');
const progressBar = document.getElementById('progress-bar');

// Updated when room list is sorted
var roomList = document.getElementById('room-list');

// Global vars

var roomNumber;
var localStream;
var remoteStream;
var rtcPeerConnection;

var localRec;
var remoteRec;
var dateStarted;

var isCaller;

var roomCounts = {}; // corresponds to room-counts list in DOM

var sessionCount = 0


// Constants

// STUN/TURN servers
const iceServers = {
    'iceServers': [
        {'urls': 'stun:stun.services.mozilla.com'}, 
        {'urls': 'stun:stun.l.google.com:19302'}, 
        {'urls': 'turn:numb.viagenie.ca',
        'credential': 'webrtc',
        'username': 'websitebeaver@mail.com'}]
};
const streamConstraints = { 
    audio: true, 
    video: { 
        width: 960, 
        height: 720, 
        framerate: {
            ideal: 25,
            max: 30,
        },
    },
};
const recordingOptions = { 
    type: 'video',
    video: {
        width: 960,
        height: 720,
    },
    framerate: {
        exact: 20,
    },
};

// Connect to socket.io server
var socket = io()

joinRoomButton.addEventListener('click', () => {
    if (!roomNumberInput.value || roomNumberInput.value === '') {
        roomNumber = 1;
    } else {
        roomNumber = roomNumberInput.value;
    }
    overlayContainer.style.display = "block";
    socket.emit('create or join', roomNumber);
});

// When server emits created
socket.on('created', (room) => {
    console.log("Got created signal, setting up stream");
    navigator.mediaDevices.getUserMedia(streamConstraints)
    .then(stream => {
        console.log("Setting up stream");
        localStream = stream;
        yourVideo.srcObject = stream;
        isCaller = true;
    })
    .catch(err => {
        alert("An error occured when accessing your media devices. Please ensure you have a working webcam and microphone");
        console.log('An error occured when accessing media devices');
    });
});

// When server emits joined
socket.on('joined', (room) => {
    console.log('Someone joined', room);
    navigator.mediaDevices.getUserMedia(streamConstraints)
    .then(stream => {
        localStream = stream;
        yourVideo.srcObject = stream;
        socket.emit('ready', roomNumber);
    })
    .catch(err => {
        alert("An error occured when accessing your media devices. Please confirm you have a working webcam and microphone");
        console.log('An error occured when accessing media devices');
    });
});

// When server emits ready
socket.on('ready', () => {
    if (isCaller) {
        rtcPeerConnection = new RTCPeerConnection(iceServers);

        // add event listeners to the connection
        rtcPeerConnection.onicecandidate = onIceCandidate;
        rtcPeerConnection.onaddstream = onAddStream;

        rtcPeerConnection.addStream(localStream);

        // prepare an offer
        rtcPeerConnection.createOffer(setLocalAndOffer, e => console.log(e));
        setupRecordInterface();
    }
});


// When server emits offer
socket.on('offer', event => {
    if (!isCaller) {
        rtcPeerConnection = new RTCPeerConnection(iceServers);

        // add event listeners to the connection
        rtcPeerConnection.onicecandidate = onIceCandidate;
        rtcPeerConnection.onaddstream = onAddStream;

        rtcPeerConnection.addStream(localStream);

        // prepare an offer
        rtcPeerConnection.setRemoteDescription(new RTCSessionDescription(event));

        // prepare an answer
        rtcPeerConnection.createAnswer(setLocalAndAnswer, e => console.log(e));
    }
});

// When server emits answer
socket.on('answer', event => {
    rtcPeerConnection.setRemoteDescription(new RTCSessionDescription(event));
});

// When emits candidate 
socket.on('candidate', event => {
    const candidate = new RTCIceCandidate({
        sdpMLineIndex: event.label,
        candidate: event.candidate
    });

    rtcPeerConnection.addIceCandidate(candidate);
});


// When server emits full
socket.on('full', room => {
    alert('Room ' + roomNumber + ' is full, please join a different room.');
})

socket.on('room count', event =>  {
    console.log("Got room count", event.counts);
    Object.keys(event.counts).forEach((room) => {
        updateListEntry(room, event.counts[room]);
    });
});

// When server emits recording
socket.on('recording', room => {
    overlayContainer.style.display = "none";
    alert('The host has started recording this session.');
});

// When server emits stop recording
socket.on('stop recording', room => {
    overlayContainer.style.display = "block";
    alert('The host has stopped recording this session.');
});

// Callbacks and helpers

function onAddStream(event) {
    friendsVideo.srcObject = event.stream;
    remoteStream = event.stream;
}

function onIceCandidate(event) {
    if (event.candidate) {
        console.log('sending ice candidate');
        socket.emit('candidate', {
            type: 'candidate',
            label: event.candidate.sdpMLineIndex,
            id: event.candidate.sdpMid,
            candidate: event.candidate.candidate,
            room: roomNumber
        });
    }
}

function setLocalAndOffer(sessionDescription) {
    rtcPeerConnection.setLocalDescription(sessionDescription);
    socket.emit('offer', {
        type: 'offer',
        sdp: sessionDescription,
        room: roomNumber
    });
}

function setLocalAndAnswer(sessionDescription) {
    rtcPeerConnection.setLocalDescription(sessionDescription);
    socket.emit('answer', {
        type: 'answer',
        sdp: sessionDescription,
        room: roomNumber
    });
}

function setupRecordInterface() {
    Array.from(recordingBlockElements).forEach(element => {
        element.classList.add("show");
    });

    startRecording.addEventListener('click', () => {
        startRecording.disabled = true;
        overlayContainer.style.display = "none";
        
        socket.emit('recording', roomNumber);
        Array.from(downloadBlockElements).forEach(element => {
            element.classList.remove("show");
            downloadRecording.classList.add('disabled');
        })

        // One recorder for each video feed
        localRec = RecordRTC(localStream, recordingOptions)

        remoteRec = RecordRTC(remoteStream, recordingOptions);

        localRec.startRecording();
        remoteRec.startRecording();

        dateStarted = new Date().getTime();
        console.log("Started Recording");

        stopRecording.disabled = false;

        (function looper() {
            if(!localRec) {
                return;
            }
            stopRecording.innerHTML = 'Stop Recording (' + calculateTimeDuration((new Date().getTime() - dateStarted) / 1000) + ')';

            setTimeout(looper, 1000);
        })();
    });
    
    stopRecording.addEventListener('click', () => {
        const zip = new JSZip();

        // Zip the videos as two webms
        let blobs = async.parallel([
            function(callback) {
                localRec.stopRecording(() => {
                    callback(null, localRec.getBlob());
                    localRec = null;
                });
            },
            function(callback) {
                remoteRec.stopRecording(() => {
                    callback(null, remoteRec.getBlob());
                    remoteRec = null;
                });
            }
        ], 
        function(err, result) {
            console.log("Zipping recordings...");
            
            sessionCount++;

            zip.folder(`recording_session_${sessionCount}`)
                .file(`your_video_session_${sessionCount}.webm`, result[0]);

            zip.folder(`recording_session_${sessionCount}`)
                .file(`their_video_session_${sessionCount}.webm`, result[1]);
            
            console.log("Generating zip...");
            zipFile = zip.generateAsync({type: "blob"}, (metadata) => {
                progressBar.style.width = metadata.percent + '%';
                progressBar.innerHTML = metadata.percent.toFixed(1) + '%';
            })
            .then((file) => {
                console.log("Generated : ) ready to download");
                downloadRecording.href = URL.createObjectURL(file);
                downloadRecording.download = `recording_session_${sessionCount}.zip`;
                downloadRecording.classList.remove('disabled');
            })
            
        });

        // Update recording interface
        startRecording.disabled = false;
        stopRecording.disabled = true;
        stopRecording.innerHTML = 'Stop Recording';
        
        Array.from(downloadBlockElements).forEach(element => {
            element.classList.add("show");
        })
        // downloadRecording.style.display = "block";

        socket.emit('stop recording', roomNumber);
    });
}

function updateListEntry(room, count) {
    // If count is zero, then we need to remove the corresponding room list item
    let prevChild = document.getElementById('room-' + room);
    if (prevChild) {
        roomList.removeChild(prevChild);
    }

    let noUsers = document.getElementById('no-users');
    if (count > 0) {    
        if (noUsers) {
            roomList.removeChild(noUsers);
        }
        let child = document.createElement('li');
        child.textContent = 'Room ' + room;
        child.id = 'room-' + room;
        child.className = 'list-group-item d-flex justify-content-between align-items-center';
        let childSpan = document.createElement('span');
        childSpan.className = 'badge badge-primary badge-pill';
        childSpan.textContent = count;
        child.appendChild(childSpan);
        roomList.appendChild(child);

        sortList(roomList);
    } else if (!noUsers) {
        noUsers = document.createElement('li');
        noUsers.textContent = 'No rooms with users, yet...';
        noUsers.id = 'no-users';
        noUsers.className = 'list-group-item d-flex justify-content-between align-items-center'
        roomList.appendChild(noUsers);
    }
}

// html ul element sorting function from stack overflow
function sortList(ul){
    var new_ul = ul.cloneNode(false);

    // Add all lis to an array
    var lis = [];
    for(var i = ul.childNodes.length; i--;){
        if(ul.childNodes[i].nodeName === 'LI')
            lis.push(ul.childNodes[i]);
    }

    // Sort the lis in descending order
    lis.sort(function(a, b){
       return parseInt(b.childNodes[0].data , 10) - 
              parseInt(a.childNodes[0].data , 10);
    });

    // Add them into the ul in order
    for(var i = 0; i < lis.length; i++)
        new_ul.appendChild(lis[i]);
    ul.parentNode.replaceChild(new_ul, ul);
    roomList = new_ul;
}


// From recordRTC duration demo
function calculateTimeDuration(secs) {
    var hr = Math.floor(secs / 3600);
    var min = Math.floor((secs - (hr * 3600)) / 60);
    var sec = Math.floor(secs - (hr * 3600) - (min * 60));

    if (min < 10) {
        min = "0" + min;
    }

    if (sec < 10) {
        sec = "0" + sec;
    }

    if(hr <= 0) {
        return min + ':' + sec;
    }

    return hr + ':' + min + ':' + sec;
}