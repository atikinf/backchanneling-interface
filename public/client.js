// TODO: rtcPeerConnection.addStream() is deprecated

// based in part on https://webrtc.ventures/2018/07/tutorial-build-video-conference-application-webrtc-2/

// DOM elements
const joinRoomButton = document.getElementById('join-room-button');
const roomNumberInput = document.getElementById('room-number-input');
const yourVideo  = document.getElementById('your-video');
const friendsVideo = document.getElementById('friends-video');
const startRecording = document.getElementById('btn-start-recording');
const stopRecording = document.getElementById('btn-stop-recording');
const downloadRecording = document.getElementById('btn-download-recording');
const overlayContainer = document.getElementById('overlay-container');
const progressBar = document.getElementById('progress-bar');

const recordingBlockElements = document.getElementsByClassName('recording-block');
const downloadBlockElements = document.getElementsByClassName('download-block');

// Global vars

var roomNumber;
var localStream;
var remoteStream;
var rtcPeerConnection;

var localRec;
var remoteRec;
var dateStarted;

var isCaller; // Whether you are the caller or not


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
const streamConstraints = { audio: true, video: true };
const recordingOptions = { 
    
    
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
        alert("An error occured when accessing your media devices. Please confirm you have a working webcam and microphone");
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
        localRec = RecordRTC(localStream, {
            type: 'video',
        })

        remoteRec = RecordRTC(remoteStream, {
            type: 'video',
        });

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
            zip.folder("recordings").file("yourVideo.webm", result[0]);
            zip.folder("recordings").file("theirVideo.webm", result[1]);
            
            console.log("Generating zip...");
            zipFile = zip.generateAsync({type: "blob"}, (metadata) => {
                progressBar.style.width = metadata.percent + '%';
                progressBar.innerHTML = metadata.percent.toFixed(1) + '%';
            })
            .then((file) => {
                console.log("Generated : ) ready to download");
                downloadRecording.href = URL.createObjectURL(file);
                downloadRecording.download = 'recordings.zip';
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