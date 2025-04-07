import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();
const router = express.Router();

const meliTokenSchema = new mongoose.Schema({
  access_token: String,
  refresh_token: String,
  user_id: Number,
  expires_in: Number,
}, { timestamps: true });

const MeliToken = mongoose.model('MeliToken', meliTokenSchema);


router.post('/token', async (req, res) => {
  const { code } = req.body;

  try {
    const response = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.MELI_CLIENT_ID,
        client_secret: process.env.MELI_CLIENT_SECRET,
        code: code,
        redirect_uri: process.env.MELI_REDIRECT_URI,
      }),
    });

    const data = await response.json();

    // Guardar el token en MongoDB
    await MeliToken.create({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        user_id: data.user_id,
        expires_in: data.expires_in,
    });
      

    res.json(data);
  } catch (err) {
    console.error('Error al obtener token:', err);
    res.status(500).json({ error: 'Error al obtener token de Mercado Libre' });
  }
});

router.get('/orders', async (req, res) => {
    try {
      const latestToken = await MeliToken.findOne().sort({ createdAt: -1 });
  
      if (!latestToken) {
        return res.status(404).json({ error: 'No hay token guardado' });
      }
  
      const response = await fetch(`https://api.mercadolibre.com/orders/search?seller=${latestToken.user_id}`, {
        headers: {
          Authorization: `Bearer ${latestToken.access_token}`,
        },
      });
  
      if (!response.ok) {
        const errorText = await response.text(); // En caso de que no sea JSON
        console.error('❌ Error al llamar a la API de ML:', errorText);
        return res.status(response.status).json({ error: 'Error al obtener órdenes de Mercado Libre' });
      }
  
      const data = await response.json();
  
      if (data.error) {
        return res.status(400).json({ error: data.message });
      }
  
      res.json(data.results);
    } catch (error) {
      console.error('❌ Error inesperado al obtener ventas de ML:', error);
      res.status(500).json({ error: 'Error inesperado al obtener ventas de Mercado Libre' });
    }
  });
  

export default router;
