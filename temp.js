// Your web app's Firebase configuration
import { firebaseConfig } from "./config/config.js";

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

let database = firebase.database().ref();
let yourVideo  = document.getElementById("yourVideo");
let friendsVideo = document.getElementById("friendsVideo");
let yourId = Math.floor(Math.random()*1000000000);
let servers = {'iceServers': [{'urls': 'stun:stun.services.mozilla.com'}, {'urls': 'stun:stun.l.google.com:19302'}, {'urls': 'turn:numb.viagenie.ca','credential': 'webrtc','username': 'websitebeaver@mail.com'}]};
let pc = new RTCPeerConnection(servers);

let shouldStop = false;
let stopped = false;
pc.onicecandidate = (event => event.candidate?sendMessage(yourId, JSON.stringify({'ice': event.candidate})):console.log("Sent All Ice") );
pc.onaddstream = (event => friendsVideo.srcObject = event.stream);

function sendMessage(senderId, data) {
  let msg = database.push({ sender: senderId, message: data });
  msg.remove();
}

function readMessage(data) {
  let msg = JSON.parse(data.val().message);
  let sender = data.val().sender;
  if (sender != yourId) {
    if (msg.ice != undefined)
    pc.addIceCandidate(new RTCIceCandidate(msg.ice));
    else if (msg.sdp.type == "offer")
    pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
    .then(() => pc.createAnswer())
    .then(answer => pc.setLocalDescription(answer))
    .then(() => sendMessage(yourId, JSON.stringify({'sdp': pc.localDescription})));
    else if (msg.sdp.type == "answer")
    pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
  }
};

database.on('child_added', readMessage);

function stopRecording() {
  shouldStop = true;
}

function showMyFace() {
  navigator.mediaDevices.getUserMedia({audio:true, video:true})
  .then(stream => yourVideo.srcObject = stream)
  .then(stream => {
    pc.addStream(stream);
    // Change button to connect and start the recording
    const conn_button = document.querySelector('#primary-button');
    conn_button.removeEventListener('click', showMyFace);
    conn_button.addEventListener('click', showFriendsFace);
    conn_button.textContent = 'Connect and Start Recording';
  });
}

function showFriendsFace() {
  pc.createOffer()
  .then(offer => pc.setLocalDescription(offer) )
  .then(() => sendMessage(yourId, JSON.stringify({'sdp': pc.localDescription})) );
}

// Binding stuff to the DOM
document.querySelector('#primary-button').addEventListener('click', showMyFace);