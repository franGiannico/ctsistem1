const express = require("express");
const jwt = require("jsonwebtoken");
const router = express.Router();

const { USUARIO_ADMIN } = require("../config/auth");

router.post("/login", (req, res) => {
    const { username, password } = req.body;

    // Validación básica
    if (!username || !password) {
        return res.status(400).json({ error: "Faltan credenciales" });
    }

    // Comparación simple (temporal)
    if (
        username !== USUARIO_ADMIN.username ||
        password !== USUARIO_ADMIN.password
    ) {
        return res.status(401).json({ error: "Credenciales inválidas" });
    }

    // Generar JWT
    const token = jwt.sign(
        {
            username: USUARIO_ADMIN.username
        },
        process.env.JWT_SECRET,
        {
            expiresIn: "8h"
        }
    );

    res.json({
        token
    });
});

module.exports = router;
