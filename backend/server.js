/********************************************************************
 *  server.js — FULL CODE WITH USER-BASED FILTERING + TITLE + NIGHT
 ********************************************************************/

import express from 'express';
import admin from 'firebase-admin';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';

// Load environment variables from .env file
dotenv.config();

// ------------------------------------------------------
//  Initialize Firebase Admin SDK
// ------------------------------------------------------
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

// ------------------------------------------------------
//  Express App + Middleware
// ------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: 'https://starfox1230.github.io', 
    methods: ['GET', 'POST', 'DELETE'],
  })
);
app.use(express.json());

// ------------------------------------------------------
//  Initialize OpenAI
// ------------------------------------------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ------------------------------------------------------
//  /generate-audio (POST)
//    - Accepts: user, title, text, voice
//    - Calls OpenAI TTS
//    - Uploads MP3 to Firebase
//    - Stores doc with user, title, text, ...
// ------------------------------------------------------
app.post('/generate-audio', async (req, res) => {
  try {
    const { user, title, text, voice } = req.body;

    console.log('POST /generate-audio:', { user, title, text, voice });

    // Validate
    if (!user) {
      return res.status(400).json({ error: 'User is required.' });
    }
    if (!title || !text) {
      return res.status(400).json({ error: 'Title and text are required.' });
    }

    // Call OpenAI TTS
    console.log('Calling OpenAI TTS API...');
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: voice || 'alloy',
      input: text,
    });

    // Convert to buffer
    const buffer = Buffer.from(await mp3.arrayBuffer());

    // Unique filename
    const timestamp = Date.now();
    const filename = `audios/audio_${timestamp}.mp3`;

    // Upload to Firebase Storage
    const file = bucket.file(filename);
    await file.save(buffer, { metadata: { contentType: 'audio/mpeg' } });
    await file.makePublic();

    // Public URL
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;

    // Save metadata to Firestore (include user, title)
    const docRef = await db.collection('audios').add({
      user,
      title,
      text,
      url: publicUrl,
      voice: voice || 'alloy',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      filePath: filename,
    });

    console.log('Audio saved with ID:', docRef.id);
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

// ------------------------------------------------------
//  /audios (GET)
//    - Optional query param ?user=someUser
//    - If user is provided, we filter by user
//    - Else, we return all audios
// ------------------------------------------------------
app.get('/audios', async (req, res) => {
  try {
    const { user } = req.query; 
    console.log('GET /audios - user:', user);

    let query = db.collection('audios').orderBy('timestamp', 'desc');
    
    // If user is provided (non-empty), filter by user
    if (user) {
      // If user is just an empty string, the query won't match anything
      // so check if user is actually non-empty
      if (user.trim().length > 0) {
        query = query.where('user', '==', user.trim());
      }
    }

    const snapshot = await query.get();
    const audios = [];
    snapshot.forEach((doc) => {
      audios.push({ id: doc.id, ...doc.data() });
    });

    console.log(`Fetched ${audios.length} audio(s) from Firestore.`);
    return res.status(200).json(audios);
  } catch (error) {
    console.error('Error fetching audios:', error);
    return res.status(500).json({ error: 'Failed to fetch audios.' });
  }
});

// ------------------------------------------------------
//  /delete-audio (DELETE)
//    - Accepts: id
//    - Deletes the doc + corresponding MP3 in Storage
// ------------------------------------------------------
app.delete('/delete-audio', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'Audio ID is required.' });
    }

    console.log('DELETE /delete-audio ID:', id);

    const docRef = db.collection('audios').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ error: 'Audio not found.' });
    }

    const audioData = docSnap.data();
    const filePath = audioData.filePath;

    // Delete from Storage
    await bucket.file(filePath).delete();
    // Delete doc
    await docRef.delete();

    console.log('Audio deleted successfully:', id);
    return res.status(200).json({ message: 'Audio deleted successfully.' });
  } catch (error) {
    console.error('Error deleting audio:', error);
    return res.status(500).json({ error: 'Failed to delete audio.' });
  }
});

// ------------------------------------------------------
//  Root Endpoint
// ------------------------------------------------------
app.get('/', (req, res) => {
  res.send('Memorize API with User Filtering is running.');
});

// ------------------------------------------------------
//  Start Server
// ------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
