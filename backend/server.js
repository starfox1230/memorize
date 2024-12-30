// server.js

import express from 'express';
import admin from 'firebase-admin';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';

// Load environment variables
dotenv.config();

const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`,
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: 'https://starfox1230.github.io', // or your domain
    methods: ['GET', 'POST', 'DELETE'],
  })
);
app.use(express.json());

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// -------------------------
//  /generate-audio
// -------------------------
app.post('/generate-audio', async (req, res) => {
  try {
    const { user, title, text, voice } = req.body;
    console.log('/generate-audio request:', { user, title, text, voice });

    if (!title || !text) {
      return res.status(400).json({ error: 'Title and text are required.' });
    }
    if (!user) {
      return res.status(400).json({ error: 'User is required.' });
    }

    // Call OpenAI's TTS API
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: voice || 'alloy',
      input: text,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    const timestamp = Date.now();
    const filename = `audios/audio_${timestamp}.mp3`;

    const file = bucket.file(filename);
    await file.save(buffer, { metadata: { contentType: 'audio/mpeg' } });
    await file.makePublic();

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;

    // Store doc with 'user' and 'title'
    const docRef = await db.collection('audios').add({
      user,
      title,
      text,
      url: publicUrl,
      voice: voice || 'alloy',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      filePath: filename,
    });

    return res.status(200).json({
      message: 'Audio generated successfully.',
      url: publicUrl,
      id: docRef.id,
    });
  } catch (error) {
    console.error('Error generating audio:', error);
    return res.status(500).json({ error: 'Failed to generate audio.' });
  }
});

// -------------------------
//  /audios
// -------------------------
//
// Optional approach: 
//  if you send ?user=someUser in the query string, 
//  then we'll filter. If no user param is provided, 
//  we return all audios.
//
app.get('/audios', async (req, res) => {
  try {
    const { user } = req.query; // or use req.body if you prefer POST
    console.log('Received /audios request. user=', user);

    let query = db.collection('audios').orderBy('timestamp', 'desc');
    if (user) {
      query = query.where('user', '==', user);
    }

    const snapshot = await query.get();
    const audios = [];
    snapshot.forEach((doc) => {
      audios.push({ id: doc.id, ...doc.data() });
    });
    console.log('Fetched audios:', audios.length);

    return res.status(200).json(audios);
  } catch (error) {
    console.error('Error fetching audios:', error);
    return res.status(500).json({ error: 'Failed to fetch audios.' });
  }
});

// -------------------------
//  /delete-audio
// -------------------------
app.delete('/delete-audio', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'Audio ID is required.' });
    }

    const docRef = db.collection('audios').doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Audio not found.' });
    }

    const audioData = doc.data();
    const filePath = audioData.filePath;

    await bucket.file(filePath).delete();
    await docRef.delete();

    return res.status(200).json({ message: 'Audio deleted successfully.' });
  } catch (error) {
    console.error('Error deleting audio:', error);
    return res.status(500).json({ error: 'Failed to delete audio.' });
  }
});

// -------------------------
//  Root
// -------------------------
app.get('/', (req, res) => {
  res.send('Memorize API (User Filter) is running.');
});

// -------------------------
//  Listen
// -------------------------
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
