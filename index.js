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
    origin: ["http://localhost:5173", "https://ph-kash-client.vercel.app"],
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

// verify token
const verifyToken = (req, res, next) => {
  const token =
    req.headers.authorization && req.headers.authorization.split(" ")[1];
  console.log("39:", req.cookies);

  console.log("token console from 34", token);
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
      console.log(req.body);
      try {
        const user = await userCollection.findOne({
          $or: [{ email }, { mobileNo }, { nid }],
        });

        if (user) {
          return res.status(400).json({ message: "User already exists" });
        }

        console.log("Registering new user");

        const hashedPassword = await bcrypt.hash(password, 10);
        await userCollection.insertOne({
          username,
          password: hashedPassword,
          email,
          mobileNo,
          role,
          nid,
          status: "pending",
          timestamp: Date.now(),
          balance: 0,
        });

        res
          .status(201)
          .json({ success: true, message: "User registered successfully" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    //login user
    app.post("/login", async (req, res) => {
      const { email, password } = req.body;
      // console.log("first", req.body);
      try {
        const user = await userCollection.findOne({ email });
        if (!user) {
          return res.send({ success: false, message: "Invalid credentials" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        console.log(isMatch);

        if (!isMatch) {
          return res.send({ success: false, message: "Invalid credentials" });
        }

        const { password: pass, ...rest } = user;
        const token = jwt.sign({ ...rest }, JWT_SECRET, { expiresIn: "1h" });
        res.send({ token, success: true, message: "Successfully Logged In" });
      } catch (error) {
        res.send({ message: "Internal server error when login" });
      }
    });

    // <>>>>>>>>>>==========><> user activity <>>>>>>=======<>>><>

    //<>>>>>>>>>>==========><> send Money =======>>>>>>>>>>>>>>>>>>>>>>

    app.post("/send-Money", async (req, res) => {
      const transactionData = req.body;
      const user = await userCollection.findOne({
        mobileNo: transactionData.mobileNo,
      });
      const sender = await userCollection.findOne({
        email: transactionData.senderEmail,
      });
      if (user.role !== "User") {
        return res.send({ success: false, message: "Receiver is not a User" });
      }

      // console.log(sender);
      if (!user) {
        return res.send({ success: false, message: "Invalid credentials" });
      }

      const isMatch = await bcrypt.compare(
        transactionData.password,
        sender.password
      );

      if (!isMatch) {
        return res.send({ success: false, message: "Invalid credentials" });
      }
      const updateBalance = parseInt(
        user.balance + transactionData.totalAmount
      );
      const sUpdateBalance = parseInt(
        sender.balance - transactionData.totalAmount
      );
      // console.log(transactionData?.totalAmount, updateBalance);
      const senderUpdateBalance = {
        $set: { balance: sUpdateBalance },
      };
      const updateData = {
        $set: {
          balance: updateBalance,
          receiverEmail: user.email,
        },
      };
      const transData = {
        ...transactionData,
        receiverEmail: user.email,
        type: "Send Money",
      };
      const id = transactionData._id;
      const query = { mobileNo: transactionData.mobileNo };
      const receiverBalance = await userCollection.updateOne(query, updateData);
      const senderBalance = await userCollection.updateOne(
        { email: transactionData.senderEmail },
        senderUpdateBalance
      );
      const result = await transactionCollection.insertOne(transData);
      res.send(result);
    });

    //<>>>>>>>=========><>Cash out <><==============>>>>>>>>>>>>>>>>>>>>>>>>><>

    app.post("/cash-out", async (req, res) => {
      const transactionData = req.body;
      const user = await userCollection.findOne({
        mobileNo: transactionData.mobileNo,
      });
      const sender = await userCollection.findOne({
        email: transactionData.senderEmail,
      });
      if (user.role !== "Agent") {
        return res.send({ success: false, message: "Receiver is not a Agent" });
      }

      // console.log(sender);
      if (!user) {
        return res.send({ success: false, message: "Invalid credentials" });
      }

      const isMatch = await bcrypt.compare(
        transactionData.password,
        sender.password
      );

      if (!isMatch) {
        return res.send({ success: false, message: "Invalid credentials" });
      }
      const transData = {
        ...transactionData,
        receiverEmail: user.email,
      };
      const result = await requestCollection.insertOne(transData);
      res.send(result);
    });

    //cash -in

    app.post("/cash-in", async (req, res) => {
      const transactionData = req.body;
      const user = await userCollection.findOne({
        mobileNo: transactionData.mobileNo,
      });
      const sender = await userCollection.findOne({
        email: transactionData.senderEmail,
      });
      if (user.role !== "Agent") {
        return res.send({
          success: false,
          message: "Receiver is not a Agent",
        });
      }

      // console.log(sender);
      if (!user) {
        return res.send({ success: false, message: "Invalid credentials" });
      }

      const transData = {
        ...transactionData,
        receiverEmail: user.email,
      };
      const result = await requestCollection.insertOne(transData);
      res.send(result);
    });

    //<>>>>=========agent transaction-management=======>>>>>>>>>>>>>>>>>
    app.get("/transaction-management/:email", verifyToken, async (req, res) => {
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
    app.get("/transaction-history/:email", verifyToken, async (req, res) => {
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

    app.get("/system-monitoring", verifyToken, async (req, res) => {
      // console.log(query);
      const result = await transactionCollection.find().toArray();
      res.send(result);
    });

    //<======>>>user-management-here========================<<<<<<<<>

    app.get("/user-management1", async (req, res) => {
      console.log("kire");
      const search = req?.query?.search || "";

      let query = search ? { username: { $regex: search, $options: "i" } } : {};
      console.log("query", query);
      const result = await userCollection.find(query).toArray();
      console.log("result", result);
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
        const sUpdateBalance = parseInt(userData.balance + 10000);
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

      const query = { email: email };
      // console.log(query);
      const result = await userCollection.findOne(query);
      res.send(result);
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
