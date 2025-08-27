import React, { useEffect, useRef, useState } from "react";
import io, { Socket } from "socket.io-client";

const VideoCall = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState("disconnected");

  const [roomId, setRoomId] = useState(null);
  const [partnerId, setPartnerId] = useState(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream>(null);

  // Video element references
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  //STURN SERVER CONFIG

  const configuration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  const createPeerConnection = async (partnerId: string, socket: Socket) => {
    console.log("Creating peer ", partnerId, socket);
    const peer = new RTCPeerConnection(configuration);

    peerConnectionRef.current = peer;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        //@ts-ignore
        peer.addTrack(track, localStreamRef.current);
      });
    }

    peer.ontrack = (event) => {
      console.log("Received remote stream");
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("Sending ICE candidate");

        if (socket) {
          socket.emit("ice-candidate", {
            target: partnerId,
            candidate: event.candidate,
          });
        }
      }
    };

    // Create and send offer to partner
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    if (socket) {
      console.log("Sending offer", partnerId);
      socket.emit("offer", {
        senderId: partnerId,
        offer: offer,
      });
    }
  };

  const handleOffer = async (offer: any, sender: string, socket: Socket) => {
    console.log("Handling offer", sender, offer);
    const peerConnection = new RTCPeerConnection(configuration);
    peerConnectionRef.current = peerConnection;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        //@ts-ignore
        peerConnection.addTrack(track, localStreamRef.current);
      });
    }

    peerConnection.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        if (socket) {
          socket.emit("ice-candidate", {
            target: sender,
            candidate: event.candidate,
          });
        }
      }
    };

    await peerConnection.setRemoteDescription(offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit("answer", {
      target: sender,
      answer: answer,
    });
  };

  const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
    if (peerConnectionRef.current) {
      await peerConnectionRef.current.setRemoteDescription(answer);
    }
  };

  const handleIceCandidate = async (candidate: RTCLocalIceCandidateInit) => {
    if (peerConnectionRef.current) {
      await peerConnectionRef.current.addIceCandidate(candidate);
      console.log("Added ice");
    }
  };

  const cleanupPeerConnection = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setRoomId(null);
    setPartnerId(null);
  };

  const findNewPartner = (socket: Socket) => {
    setStatus("searching");
    socket.emit("join-queue");
  };

  const handleSkip = () => {
    if (socket) {
      socket.emit("skip");
      cleanupPeerConnection();
      setStatus("searching");
    }
  };

  const handleStart = () => {
    if (socket) {
      findNewPartner(socket);
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "connected":
        return "Connected to server";
      case "searching":
        return "Looking for someone to chat with...";
      case "waiting":
        return "Waiting for a partner...";
      case "matched":
        return "Connected! Say hello!";
      case "partner-left":
        return "Partner left. Finding new partner...";
      default:
        return "Connecting...";
    }
  };
  useEffect(() => {
    const newSocket = io("http://localhost:5000");
    setSocket(newSocket);

    // Get user's camera and microphone
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        localStreamRef.current = new MediaStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      })
      .catch((err) => console.error("Error accessing media devices:", err));

    newSocket.on("connect", () => {
      setIsConnected(true);
      setStatus("connected");
      console.log("Connected to server", newSocket.id);
    });

    newSocket.on("waiting", () => {
      setStatus("waiting");
      console.log("Waiting for a partner...");
    });

    newSocket.on("matched", async ({ roomId, partnerId }) => {
      setStatus("matched");
      console.log("MATCHED", partnerId);
      setRoomId(roomId);
      setPartnerId(partnerId);
      await createPeerConnection(partnerId, newSocket);
    });

    newSocket.on("offer", async ({ offer, senderId }) => {
      console.log("Received offer-> ", senderId, offer);
      await handleOffer(offer, senderId, newSocket);
    });

    newSocket.on("answer", async ({ answer }) => {
      await handleAnswer(answer);
    });

    newSocket.on("ice-candidate", async ({ candidate }) => {
      await handleIceCandidate(candidate);
    });

    newSocket.on("partner-left", () => {
      setStatus("partner-left");
      console.log("Partner left");
      cleanupPeerConnection();
      // Find new partner after 2 seconds
      setTimeout(() => {
        findNewPartner(newSocket);
      }, 2000);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  return (
    <div style={{ padding: "20px", textAlign: "center" }}>
      <h1>Random Video Chat</h1>

      <div style={{ marginBottom: "20px" }}>
        <p>
          <strong>Status:</strong> {getStatusText()}
        </p>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: "20px",
          marginBottom: "20px",
        }}
      >
        <div>
          <h3>You</h3>
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            style={{ width: "300px", height: "200px", backgroundColor: "#000" }}
          />
        </div>

        <div>
          <h3>Partner</h3>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            style={{ width: "300px", height: "200px", backgroundColor: "#000" }}
          />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: "10px" }}>
        {status === "connected" && (
          <button onClick={handleStart} style={buttonStyle}>
            Start Chat
          </button>
        )}

        {(status === "matched" || partnerId) && (
          <button
            onClick={handleSkip}
            style={{ ...buttonStyle, backgroundColor: "#ff4444" }}
          >
            Skip / Next
          </button>
        )}
      </div>
    </div>
  );
};

const buttonStyle = {
  padding: "10px 20px",
  fontSize: "16px",
  backgroundColor: "#4CAF50",
  color: "white",
  border: "none",
  borderRadius: "4px",
  cursor: "pointer",
  margin: "5px",
};

export default VideoCall;
