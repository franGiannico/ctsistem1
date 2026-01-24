// config/auth.js

const USUARIO_ADMIN = {
    username: process.env.ADMIN_USERNAME || "admin",
    password: process.env.ADMIN_PASSWORD || "cambia_esta_password_segura"
};

module.exports = {
    USUARIO_ADMIN
};
