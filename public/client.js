// DOM elements
const joinRoomButton = document.getElementById('join-room-button');
const roomNumberInput = document.getElementById('room-number-input');
const yourVideo  = document.getElementById("yourVideo");
const friendsVideo = document.getElementById("friendsVideo");

// Global vars

var roomNumber;
var localStream;
var remoteStream;
var rtcPeerConnection;

// STUN/TURN servers
let iceServers = {
    'iceServers': [
        {'urls': 'stun:stun.services.mozilla.com'}, 
        {'urls': 'stun:stun.l.google.com:19302'}, 
        {'urls': 'turn:numb.viagenie.ca',
        'credential': 'webrtc',
        'username': 'websitebeaver@mail.com'}]
};
var streamConstraints = { audio: true, video: true };
var isCaller; // Whether you are the caller or not

// Connect to socket.io server
var socket = io()

joinRoomButton.addEventListener('click', () => {
    if (!roomNumberInput.value || roomNumberInput.value === '') {
        roomNumber = 1;
    } else {
        roomNumber = roomNumberInput.value;
        // Potentially add DOM stuff here
    }
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
        setupRecordInterface();
    })
    .catch(err => console.log('An error occured when accessing media devices'));
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
    .catch(err => console.log('An error occured when accessing media devices'));
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

// Callbacks

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
    const recordingBlock = document.querySelector('#recording-block');
    recordingBlock.style.display = "block";
    // TODO: Impelment some sort of recording system
    // Be it a media server or simply local recording.
}