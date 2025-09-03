import React, { useEffect, useRef, useState } from "react";
import io, { Socket } from "socket.io-client";

const VideoCall = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  // const [isConnected, setIsConnected] = useState(false);
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

  const createPeerConnection = async (
    partnerId: string,
    socket: Socket,
    isOfferer: boolean
  ) => {
    try {
      console.log(
        "Creating peer connection as",
        isOfferer ? "offerer" : "answerer"
      );

      // Close existing connection if any
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }

      const peer = new RTCPeerConnection(configuration);

      peerConnectionRef.current = peer;

      // Monitor connection state changes
      peer.onconnectionstatechange = () => {
        console.log("Connection state changed:", peer.connectionState);
        if (peer.connectionState === "connected") {
          console.log("WebRTC connection established!");
        } else if (peer.connectionState === "failed") {
          console.log("WebRTC connection failed");
        }

        //RECONNECTION
        // setTimeout(() => {
        //   if (partnerId && socket) {
        //     createPeerConnection(partnerId, socket, isOfferer);
        //   }
        // }, 2000);
      };

      // Monitor ICE connection state
      peer.oniceconnectionstatechange = () => {
        console.log("ICE connection state:", peer.iceConnectionState);
      };

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          //@ts-ignore
          peer.addTrack(track, localStreamRef.current);
        });
      }

      peer.ontrack = (event) => {
        console.log("Received remote stream", event.streams[0]);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          console.log("Sending ICE candidate to", partnerId);

          if (socket) {
            socket.emit("ice-candidate", {
              target: partnerId,
              candidate: event.candidate,
            });
          }
        }
      };

      if (isOfferer) {
        console.log("Creating offer as initiator");
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);

        if (socket) {
          console.log("Sending offer to", partnerId);
          socket.emit("offer", {
            target: partnerId,
            offer: offer,
          });
        }
      }
    } catch (error) {
      console.log("ERROR ", error);
    }
  };

  const handleOffer = async (offer: any, sender: string, socket: Socket) => {
    console.log("Handling offer", sender, offer);
    const peerConnection = new RTCPeerConnection(configuration);
    peerConnectionRef.current = peerConnection;

    // Monitor connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log(
        "Answer peer connection state changed:",
        peerConnection.connectionState
      );
      if (peerConnection.connectionState === "connected") {
        console.log("WebRTC connection established in answer handler!");
      }
    };

    // Monitor ICE connection state
    peerConnection.oniceconnectionstatechange = () => {
      console.log(
        "Answer peer ICE connection state:",
        peerConnection.iceConnectionState
      );
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        //@ts-ignore
        peerConnection.addTrack(track, localStreamRef.current);
      });
    }

    peerConnection.ontrack = (event) => {
      console.log("Received remote stream in answer handler", event.streams[0]);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("Sending ICE candidate to", sender);
        if (socket) {
          socket.emit("ice-candidate", {
            target: sender,
            candidate: event.candidate,
          });
        }
      }
    };

    try {
      await peerConnection.setRemoteDescription(offer);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      console.log("Sending answer to", sender);
      socket.emit("answer", {
        target: sender,
        answer: answer,
      });
    } catch (error) {
      console.error("Error handling offer:", error);
    }
  };

  const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
    console.log("Received answer", answer);
    if (peerConnectionRef.current) {
      try {
        await peerConnectionRef.current.setRemoteDescription(answer);
        console.log("Set remote description successfully");
      } catch (error) {
        console.error("Error setting remote description:", error);
      }
    }
  };

  const handleIceCandidate = async (candidate: RTCIceCandidate) => {
    console.log("Received ICE candidate", candidate);
    if (peerConnectionRef.current) {
      try {
        await peerConnectionRef.current.addIceCandidate(candidate);
        console.log("Added ICE candidate successfully");
      } catch (error) {
        console.error("Error adding ICE candidate:", error);
      }
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
    // setRoomId(null);
    setPartnerId(null);
  };

  const findNewPartner = (socket: Socket) => {
    // setStatus("searching");
    socket.emit("join-queue");
  };

  const handleSkip = () => {
    if (socket) {
      socket.emit("skip");
      cleanupPeerConnection();
      setStatus("searching");

      // Automatically rejoin queue after skipping
      socket.emit("join-queue");
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
        return "Connected to server you are ready!!";
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
      // setIsConnected(true);
      setStatus("connected");
      console.log("Connected to server", newSocket.id);
    });

    newSocket.on("waiting", () => {
      setStatus("waiting");
      console.log("Waiting for a partner...");
    });

    newSocket.on("matched", async ({ roomId, partnerId, isInitiator }) => {
      setStatus("matched");
      console.log("MATCHED with partner:", partnerId, "in room:", roomId);
      // setRoomId(roomId);
      setPartnerId(partnerId);
      await createPeerConnection(partnerId, newSocket, isInitiator);
    });

    newSocket.on("offer", async ({ offer, senderId }) => {
      console.log("Received offer from:", senderId, "offer:", offer);
      await handleOffer(offer, senderId, newSocket);
    });

    newSocket.on("answer", async ({ answer }) => {
      console.log("Received answer:", answer);
      await handleAnswer(answer);
    });

    newSocket.on("ice-candidate", async ({ candidate }) => {
      console.log("Received ICE candidate:");
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
    <section className="">
      <div className="">
        <div className="text-4xl text-center my-5 py-[30px]">
          Strangers United
        </div>
      </div>

      <div className="my-2 text-center">
        <strong>Status:</strong> {getStatusText()}
      </div>

      <div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-auto md:h-[550px] ">
          <div>
            <div className="font-serif text-3xl">You</div>
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-64 md:h-[500px] object-cover rounded  bg-gray-400"
            />
          </div>

          <div>
            <div className="font-serif text-3xl">Stranger</div>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-64 md:h-[500px]  object-cover rounded bg-gray-400"
            />
          </div>
        </div>

        <div className="flex flex-col md:flex-row justify-center  gap-4 mt-5 w-full md:w-auto">
          {status === "connected" && (
            <button
              className="bg-green-500 p-4 rounded-2xl w-full md:w-auto"
              onClick={handleStart}
            >
              Start Chat
            </button>
          )}

          {status === "matched" && partnerId && (
            <button
              className="bg-red-500 p-4 rounded-2xl w-full md:w-auto"
              onClick={handleSkip}
            >
              Skip
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

export default VideoCall;
