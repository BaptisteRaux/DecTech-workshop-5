import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";

type Message = {
  type: "propose" | "vote";
  value: Value;
  step: number;
  sender: number;
};

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  const state: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0
  };

  // Stockage des messages reçus par étape
  const messages: { [key: number]: Message[] } = {};

  async function broadcast(message: Message) {
    if (state.killed) return;
    
    for (let i = 0; i < N; i++) {
      if (i !== nodeId) {
        try {
          await fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
          });
        } catch (error) {
          console.error(`Failed to send message to node ${i}`);
        }
      }
    }
  }

  // Route pour obtenir le statut du nœud
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  // Route pour obtenir l'état actuel du nœud
  node.get("/getState", (req, res) => {
    res.json(state);
  });

  node.post("/message", (req, res) => {
    if (state.killed || isFaulty) {
      res.status(500).send("node is not accepting messages");
      return;
    }

    const message: Message = req.body;
    if (!messages[message.step]) {
      messages[message.step] = [];
    }
    messages[message.step].push(message);
    
    res.status(200).send("message received");
  });

  async function startConsensus() {
    while (!state.decided && !state.killed) {
      // Phase 1: Propose
      await broadcast({
        type: "propose",
        value: state.x as Value,
        step: state.k as number,
        sender: nodeId
      });

      // Attendre les messages des autres nœuds
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Traiter les messages reçus
      const currentMessages = messages[state.k as number] || [];
      const proposeMessages = currentMessages.filter(m => m.type === "propose");

      if (proposeMessages.length > N - F) {
        // Logique de décision basée sur les messages reçus
        // ... à compléter selon l'algorithme Ben-Or
      }

      if (state.k !== null) {
        state.k++;
      }
    }
  }

  node.get("/start", async (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty node cannot start consensus");
      return;
    }
    
    state.killed = false;
    state.k = 0;
    state.x = initialValue;
    state.decided = false;
    
    startConsensus();
    res.status(200).send("consensus started");
  });

  node.get("/stop", async (req, res) => {
    state.killed = true;
    res.status(200).send("node stopped");
  });

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}
