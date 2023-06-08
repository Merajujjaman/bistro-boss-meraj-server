const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
var jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config()
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)

const app = express()
const port = process.env.PORT || 5000;

//midleware:
app.use(cors())
app.use(express.json())

// jwt midleware functuon: 
const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' })
    }
    // bearer token
    const token = authorization.split(' ')[1]

    //verify token
    jwt.verify(token, process.env.ACCESS_TOKEN, (error, decoded) => {
        if (error) {
            return res.status(401).send({ error: true, message: 'unauthorized access' })
        }
        req.decoded = decoded;
        next()
    })
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.zrkl84y.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        const menuCollection = client.db("bistroDB").collection("menu");
        const usersCollection = client.db("bistroDB").collection("users");
        const reviewCollection = client.db("bistroDB").collection("reviews");
        const cartCollection = client.db("bistroDB").collection("carts");
        const paymentCollection = client.db("bistroDB").collection("payments");

        //jwt token create:
        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
            res.send({ token })
        })

        //verify admin: //use verifyJWT before using verifyAdmin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query)

            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }

            next()
        }

        //user collection api:
        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray()
            res.send(result)
        });

        app.post('/users', async (req, res) => {
            const userData = req.body;
            const query = { email: userData.email }
            const existingUser = await usersCollection.findOne(query)
            if (existingUser) {
                return res.send({ message: 'already have an account' })
            }
            const result = await usersCollection.insertOne(userData);
            res.send(result);
        });

        app.get('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                res.send({ admin: false })
            }
            const query = { email: email };
            const user = await usersCollection.findOne(query)
            const result = { admin: user?.role === 'admin' }
            res.send(result)
        })

        app.delete('/users/delete/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const result = await usersCollection.deleteOne(filter);
            res.send(result)
        })

        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateUser = {
                $set: {
                    role: 'admin'
                },
            };

            const result = await usersCollection.updateOne(filter, updateUser);
            res.send(result)

        })


        // menu collection:
        app.get('/menu', async (req, res) => {
            const result = await menuCollection.find().toArray()
            res.send(result)
        })

        app.post('/menu', verifyJWT, verifyAdmin, async (req, res) => {
            const newItem = req.body;
            const result = await menuCollection.insertOne(newItem);
            res.send(result)
        })

        app.delete('/menu/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await menuCollection.deleteOne(query);
            res.send(result)
        })

        // reviews:
        app.get('/reviews', async (req, res) => {
            const result = await reviewCollection.find().toArray()
            res.send(result)
        })

        //cart collection:
        app.post('/carts', async (req, res) => {
            const cartData = req.body;
            const result = await cartCollection.insertOne(cartData)
            res.send(result)
        })

        app.get('/carts', verifyJWT, async (req, res) => {
            const email = req.query.email;

            const decodedEmail = req.decoded.email;
            if (decodedEmail !== email) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }

            if (!email) {
                return res.send([])
            }

            const query = { email: email }
            const result = await cartCollection.find(query).toArray()
            res.send(result)
        })

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await cartCollection.deleteOne(query)
            res.send(result)
        })

        // create payment intent:
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = Math.round(price * 100)
            // console.log(amount);

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"],
            });

            res.send({
                clientSecret: paymentIntent.client_secret
            })

        })

        // payment collection:
        app.post('/payments', verifyJWT, async (req, res) => {
            const paymentData = req.body;
            const insertedResult = await paymentCollection.insertOne(paymentData)
            const query = { _id: { $in: paymentData.cartItems.map(id => new ObjectId(id)) } }
            const deletedResult = await cartCollection.deleteMany(query)
            res.send({ insertedResult, deletedResult })
        })

        app.get('/admin-stats', verifyJWT, verifyAdmin, async (req, res) => {
            const customers = await usersCollection.estimatedDocumentCount()
            const products = await menuCollection.estimatedDocumentCount()
            const orders = await paymentCollection.estimatedDocumentCount()
            const payments = await paymentCollection.find().toArray()
            const revenue = payments.reduce((sum, item) => sum + item.price, 0)

            res.send({ customers, products, orders, revenue })
        })

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('bistro boss is open...')
})

app.listen(port, () => {
    console.log(`bistro boss server in running on port ${port}`);
})