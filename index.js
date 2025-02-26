const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const bcrypt = require("bcryptjs");
require("dotenv").config();
const config = process.env;
const PORT = process.env.PORT || 5000;
const app = express();
const JWT_SECRET = process.env.ACCESS_TOKEN_SECRET || "your_jwt_secret";

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.6ypdnj9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://ph-kash-client.vercel.app",
      "https://ph-cash-server.vercel.app",
    ],
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

// verify token
const verifyToken = (req, res, next) => {
  const token =
    req.headers.authorization && req.headers.authorization.split(" ")[1];
  // console.log("39:", req.cookies);

  // console.log("token console from 34", token);
  if (!token) return res.status(401).send({ message: "t Un Authorize" });
  if (token) {
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).send({ message: "Un Authorize  t " });
      }
      req.user = decoded;
      next();
    });
  }
};

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    //database collections are here
    const database = client.db("PHS-Cash");
    const userCollection = database.collection("users");
    const transactionCollection = database.collection("transaction");
    const requestCollection = database.collection("request");

    app.post("/register", async (req, res) => {
      const { username, email, password, mobileNo, nid, role } = req.body;

      const user = await userCollection.findOne({
        $or: [{ email }, { mobileNo }, { nid }],
      });
      if (user) {
        return res.status(400).json({ message: "User already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const balance = role === "User";

      await userCollection.insertOne({
        username,
        password: hashedPassword,
        email,
        mobileNo,
        role,
        nid,
        status: "pending",
        timestamp: Date.now(),
        balance,
      });

      res
        .status(201)
        .json({ success: true, message: "User registered successfully" });
    });

    //login user
    app.post("/login", async (req, res) => {
      const { email, password } = req.body;

      const user = await userCollection.findOne({ email });
      if (!user) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      const token = jwt.sign(
        { userId: user._id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: "1h" }
      );
      res.json({ success: true, message: "Login successful", token });
    });

    // <>>>>>>>>>>==========><> user activity <>>>>>>=======<>>><>

    //<>>>>>>>>>>==========><> send Money =======>>>>>>>>>>>>>>>>>>>>>>

    app.post("/send-money", async (req, res) => {
      const { senderEmail, receiverMobile, amount } = req.body;

      if (amount < 50) {
        return res.status(400).json({ message: "Minimum amount is 50 taka" });
      }

      const sender = await userCollection.findOne({ email: senderEmail });
      const receiver = await userCollection.findOne({
        mobileNo: receiverMobile,
      });

      if (!sender || !receiver) {
        return res.status(400).json({ message: "Invalid sender or receiver" });
      }

      if (sender.balance < amount) {
        return res.status(400).json({ message: "Insufficient balance" });
      }

      const fee = amount > 100 ? 5 : 0;
      const totalAmount = amount + fee;

      // Deduct from sender
      await userCollection.updateOne(
        { email: senderEmail },
        { $inc: { balance: -totalAmount } }
      );

      // Add to receiver
      await userCollection.updateOne(
        { mobileNo: receiverMobile },
        { $inc: { balance: amount } }
      );

      // Add fee to admin
      await userCollection.updateOne(
        { role: "Admin" },
        { $inc: { balance: fee } }
      );

      // Record transaction
      const transaction = {
        senderEmail,
        receiverMobile,
        amount,
        fee,
        type: "Send Money",
        transactionId: new ObjectId(),
        date: new Date(),
      };
      await transactionCollection.insertOne(transaction);

      res.json({ success: true, message: "Money sent successfully" });
    });

    //<>>>>>>>=========><>Cash out <><==============>>>>>>>>>>>>>>>>>>>>>>>>><>

    app.post("/cash-out", async (req, res) => {
      const { userEmail, agentMobile, amount } = req.body;

      if (amount < 50) {
        return res.status(400).json({ message: "Minimum amount is 50 taka" });
      }

      const user = await userCollection.findOne({ email: userEmail });
      const agent = await userCollection.findOne({
        mobileNo: agentMobile,
        role: "Agent",
      });

      if (!user || !agent) {
        return res.status(400).json({ message: "Invalid user or agent" });
      }

      if (user.balance < amount) {
        return res.status(400).json({ message: "Insufficient balance" });
      }

      const fee = amount * 0.015;
      const agentEarnings = amount * 0.01;
      const adminEarnings = amount * 0.005;

      // Deduct from user
      await userCollection.updateOne(
        { email: userEmail },
        { $inc: { balance: -(amount + fee) } }
      );

      // Add to agent
      await userCollection.updateOne(
        { mobileNo: agentMobile },
        { $inc: { balance: amount, income: agentEarnings } }
      );

      // Add to admin
      await userCollection.updateOne(
        { role: "Admin" },
        { $inc: { balance: adminEarnings } }
      );

      // Record transaction
      const transaction = {
        userEmail,
        agentMobile,
        amount,
        fee,
        type: "Cash Out",
        transactionId: new ObjectId(),
        date: new Date(),
      };
      await transactionCollection.insertOne(transaction);

      res.json({ success: true, message: "Cash-out successful" });
    });

    //cash -in

    app.post("/cash-in", async (req, res) => {
      const { userMobile, agentEmail, amount, agentPin } = req.body;

      const user = await userCollection.findOne({ mobileNo: userMobile });
      const agent = await userCollection.findOne({
        email: agentEmail,
        role: "Agent",
      });

      if (!user || !agent) {
        return res.status(400).json({ message: "Invalid user or agent" });
      }

      const isPinValid = await bcrypt.compare(agentPin, agent.pin);
      if (!isPinValid) {
        return res.status(400).json({ message: "Invalid agent PIN" });
      }

      // Add to user
      await userCollection.updateOne(
        { mobileNo: userMobile },
        { $inc: { balance: amount } }
      );

      // Record transaction
      const transaction = {
        userMobile,
        agentEmail,
        amount,
        type: "Cash In",
        transactionId: new ObjectId(),
        date: new Date(),
      };
      await transactionCollection.insertOne(transaction);

      res.json({ success: true, message: "Cash-in successful" });
    });

    //<>>>>=========agent transaction-management=======>>>>>>>>>>>>>>>>>
    app.get("/transaction-management/:email", async (req, res) => {
      const email = req.params.email;
      const query = {
        receiverEmail: email,
      };
      // console.log(query);
      const result = await requestCollection.find(query).toArray();
      res.send(result);
    });

    //<>>>>>>==========reject request from agent ==================<<<<<<<<<<<<>
    app.delete("/reject-request/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await requestCollection.deleteOne(query);
      res.send(result);
    });

    //<>>>>>>>======approve request of cash in and cash out===========<<<<<<<>

    app.patch("/approve-request/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const reqData = await requestCollection.findOne(query);
      const senderData = await userCollection.findOne({
        email: reqData.senderEmail,
      });
      const receiverData = await userCollection.findOne({
        email: reqData.receiverEmail,
      });
      // console.log(senderData, receiverData);

      //checking request type

      if (reqData.type === "Cash Out") {
        const rUpdateBalance = parseInt(
          receiverData.balance + reqData.totalAmount
        );
        const sUpdateBalance = parseInt(
          senderData.balance - reqData.totalAmount
        );
        // console.log(transactionData?.totalAmount, updateBalance);
        const senderUpdateBalance = {
          $set: { balance: sUpdateBalance },
        };
        const updateData = {
          $set: {
            balance: rUpdateBalance,
          },
        };
        const query = { email: reqData.receiverEmail };
        const receiverBalance = await userCollection.updateOne(
          query,
          updateData
        );
        const senderBalance = await userCollection.updateOne(
          { email: reqData.senderEmail },
          senderUpdateBalance
        );
        const result = await transactionCollection.insertOne(reqData);
        res.send(result);
      } else {
        const rUpdateBalance = parseInt(
          receiverData.balance - reqData.totalAmount
        );
        const sUpdateBalance = parseInt(
          senderData.balance + reqData.totalAmount
        );
        // console.log(transactionData?.totalAmount, updateBalance);
        const senderUpdateBalance = {
          $set: { balance: sUpdateBalance },
        };
        const updateData = {
          $set: {
            balance: rUpdateBalance,
          },
        };
        const query = { email: reqData.receiverEmail };
        const receiverBalance = await userCollection.updateOne(
          query,
          updateData
        );
        const senderBalance = await userCollection.updateOne(
          { email: reqData.senderEmail },
          senderUpdateBalance
        );
        const result = await transactionCollection.insertOne(reqData);
        res.send(result);
      }
    });

    //<>>>>>>>>>>>>>>>agent transaction-management=======<<<<<<<<<<>
    app.get("/transaction-history/:email", async (req, res) => {
      const email = req.params.email;
      const userData = await userCollection.findOne({ email });
      const query1 = {
        senderEmail: email,
      };

      if (userData.role === "Agent") {
        const query = {
          receiverEmail: email,
        };
        // console.log(query);
        const result = await transactionCollection.find(query).toArray();
        res.send(result);
      } else {
        const query1 = {
          senderEmail: email,
        };
        const query2 = {
          receiverEmail: email,
        };

        const result1 = await transactionCollection.find(query1).toArray();
        const result2 = await transactionCollection.find(query2).toArray();
        res.send([...result1, ...result2]);
      }
    });

    //-----------------admin functionality----------------
    //<>>>>>>===system-monitoring-here =======<<<<<<<>

    app.get("/system-monitoring", async (req, res) => {
      // console.log(query);
      const result = await transactionCollection.find().toArray();
      res.send(result);
    });

    //<======>>>user-management-here========================<<<<<<<<>

    app.get("/user-management1", async (req, res) => {
      // console.log("kire");
      const search = req?.query?.search || "";

      let query = search ? { username: { $regex: search, $options: "i" } } : {};
      // console.log("query", query);
      const result = await userCollection.find(query).toArray();
      // console.log("result", result);
      res.send(result);
    });

    // reject-user ====================>>>>>>>>>>>>>>>>>>
    app.patch("/reject-user/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const updateData = {
        $set: {
          status: "Block",
        },
      };
      const result = await userCollection.updateOne(query, updateData);
      res.send(result);
    });
    // reject-user ====================>>>>>>>>>>>>>>>>>>
    app.patch("/approve-user/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const userData = await userCollection.findOne(query);
      if (userData.role === "User") {
        const sUpdateBalance = parseInt(userData.balance + 40);
        // console.log(transactionData?.totalAmount, updateBalance);
        const userUpdateBalance = {
          $set: { balance: sUpdateBalance },
        };
        const user = await userCollection.updateOne(query, userUpdateBalance);
      } else {
        const sUpdateBalance = parseInt(userData.balance + 100000);
        // console.log(transactionData?.totalAmount, updateBalance);
        const userUpdateBalance = {
          $set: { balance: sUpdateBalance },
        };
        const user = await userCollection.updateOne(query, userUpdateBalance);
      }
      const updateData = {
        $set: {
          status: "Active",
        },
      };
      const result = await userCollection.updateOne(query, updateData);
      res.send(result);
    });

    //User balance inquiry ==================>>>>>>>>>>>>>

    app.get("/user-balance/:email", async (req, res) => {
      const email = req.params.email;

      const user = await userCollection.findOne({ email });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ balance: user.balance });
    });
  } finally {
  }
}
run().catch(console.dir);

// Connection

app.get("/", (req, res) => {
  res.send("PH-Kash server is live");
});
app.listen(PORT, () => {
  console.log(`PH-Kash Web is running in port:  ${PORT}`);
});
