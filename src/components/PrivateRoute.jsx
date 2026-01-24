import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';

const PrivateRoute = () => {
    // Verificar si existe el token en localStorage
    // Para mayor seguridad, aquí se podría validar la expiración del token decodificando el JWT
    const token = localStorage.getItem('token');

    // Si hay token, renderizar las rutas hijas (Outlet)
    // Si no hay token, redirigir al login
    return token ? <Outlet /> : <Navigate to="/login" replace />;
};

export default PrivateRoute;
