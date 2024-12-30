// server.js

import express from 'express';
import admin from 'firebase-admin';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { URL } from 'url'; // Import URL for parsing

// Load environment variables from .env file
dotenv.config();

// Initialize Firebase Admin SDK
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`, // Corrected bucket URL
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: 'https://starfox1230.github.io', // Your GitHub Pages URL without trailing slash
  methods: ['GET', 'POST', 'DELETE']
}));
app.use(express.json());

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Endpoint to generate audio
app.post('/generate-audio', async (req, res) => {
  try {
    const { text, voice } = req.body;

    console.log('Received /generate-audio request:', { text, voice });

    if (!text) {
      console.warn('No text provided in the request.');
      return res.status(400).json({ error: 'Text is required.' });
    }

    // Call OpenAI's TTS API
    console.log('Calling OpenAI TTS API...');
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: voice || "alloy",
      input: text,
    });

    console.log('Received response from OpenAI:', mp3);

    // Convert response to buffer
    const buffer = Buffer.from(await mp3.arrayBuffer());
    console.log('Converted OpenAI response to buffer.');

    // Generate a unique filename
    const timestamp = Date.now();
    const filename = `audios/audio_${timestamp}.mp3`;
    console.log(`Uploading audio to Firebase Storage with filename: ${filename}`);

    // Upload to Firebase Storage
    const file = bucket.file(filename);
    await file.save(buffer, {
      metadata: {
        contentType: 'audio/mpeg',
      },
    });
    console.log('Audio uploaded to Firebase Storage.');

    // Make the file publicly accessible
    await file.makePublic();
    console.log('Audio file made public.');

    // Get the public URL
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
    console.log(`Public URL generated: ${publicUrl}`);

    // Save metadata to Firestore
    const docRef = await db.collection('audios').add({
      text: text,
      url: publicUrl,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      voice: voice || "alloy",
    });
    console.log('Audio metadata saved to Firestore with ID:', docRef.id);

    res.status(200).json({ message: 'Audio generated successfully.', url: publicUrl, id: docRef.id });
  } catch (error) {
    console.error('Error generating audio:', error);
    res.status(500).json({ error: 'Failed to generate audio.' });
  }
});

// Endpoint to fetch audio list
app.get('/audios', async (req, res) => {
  try {
    console.log('Received /audios request.');
    const audiosSnapshot = await db.collection('audios').orderBy('timestamp', 'desc').get();
    const audios = [];
    audiosSnapshot.forEach(doc => {
      audios.push({ id: doc.id, ...doc.data() });
    });
    console.log('Fetched audios from Firestore:', audios.length);
    res.status(200).json(audios);
  } catch (error) {
    console.error('Error fetching audios:', error);
    res.status(500).json({ error: 'Failed to fetch audios.' });
  }
});

// Endpoint to delete audio
app.delete('/delete-audio', async (req, res) => {
  try {
    const { id } = req.body;

    console.log('Received /delete-audio request for ID:', id);

    if (!id) {
      console.warn('No ID provided in the request.');
      return res.status(400).json({ error: 'Audio ID is required.' });
    }

    // Fetch the document from Firestore
    const docRef = db.collection('audios').doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      console.warn(`No audio found with ID: ${id}`);
      return res.status(404).json({ error: 'Audio not found.' });
    }

    const audioData = doc.data();
    const fileUrl = audioData.url;

    console.log('File URL:', fileUrl);

    // Extract the filename from the URL using URL module
    const parsedUrl = new URL(fileUrl);
    const pathname = parsedUrl.pathname; // e.g., /audios/audio_1735530150996.mp3
    const filename = pathname.startsWith('/') ? pathname.slice(1) : pathname; // audios/audio_1735530150996.mp3

    console.log(`Deleting file: ${filename} from Firebase Storage.`);

    // Delete the file from Firebase Storage
    const file = bucket.file(filename);
    await file.delete();

    console.log(`File ${filename} deleted from Firebase Storage.`);

    // Delete the document from Firestore
    await docRef.delete();

    console.log(`Document with ID ${id} deleted from Firestore.`);

    res.status(200).json({ message: 'Audio deleted successfully.' });
  } catch (error) {
    console.error('Error deleting audio:', error);
    res.status(500).json({ error: 'Failed to delete audio.' });
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
