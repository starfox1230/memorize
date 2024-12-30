// server.js

import express from 'express';
import admin from 'firebase-admin';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import OpenAI from 'openai';

dotenv.config();

// Initialize Firebase Admin SDK
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: `${process.env.FIREBASE_PROJECT_ID}.appspot.com`,
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: 'https://your-username.github.io/memorize/', // Replace with your GitHub Pages URL
  methods: ['GET', 'POST']
}));
app.use(express.json());

// Endpoint to generate audio
app.post('/generate-audio', async (req, res) => {
  try {
    const { text, voice } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required.' });
    }

    // Initialize OpenAI
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Call OpenAI's TTS API
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: voice || "alloy",
      input: text,
    });

    // Convert response to buffer
    const buffer = Buffer.from(await mp3.arrayBuffer());

    // Generate a unique filename
    const timestamp = Date.now();
    const filename = `audios/audio_${timestamp}.mp3`;

    // Upload to Firebase Storage
    const file = bucket.file(filename);
    await file.save(buffer, {
      metadata: {
        contentType: 'audio/mpeg',
      },
    });

    // Make the file publicly accessible
    await file.makePublic();

    // Get the public URL
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;

    // Save metadata to Firestore
    await db.collection('audios').add({
      text: text,
      url: publicUrl,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      voice: voice || "alloy",
    });

    res.status(200).json({ message: 'Audio generated successfully.', url: publicUrl });
  } catch (error) {
    console.error('Error generating audio:', error.message);
    res.status(500).json({ error: 'Failed to generate audio.' });
  }
});

// Endpoint to fetch audio list
app.get('/audios', async (req, res) => {
  try {
    const audiosSnapshot = await db.collection('audios').orderBy('timestamp', 'desc').get();
    const audios = [];
    audiosSnapshot.forEach(doc => {
      audios.push({ id: doc.id, ...doc.data() });
    });
    res.status(200).json(audios);
  } catch (error) {
    console.error('Error fetching audios:', error.message);
    res.status(500).json({ error: 'Failed to fetch audios.' });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.send('Memorize API is running.');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
