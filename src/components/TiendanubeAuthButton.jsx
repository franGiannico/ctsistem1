import React, { useState } from 'react';
import styles from './Apiventas.module.css'; // Reusar estilos si es posible

const TiendanubeAuthButton = ({ className, wrapperClassName }) => {
    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
    const [loading, setLoading] = useState(false);

    // Función helper para requests autenticados (opcional si el endpoint es público, pero mejor mantener consistencia)
    // En este caso, /auth puede ser público o no. Asumimos público o con token estático básico si es necesario.
    // Pero generalmente el endpoint /auth inicia el flujo OAuth y devuelve una URL.

    const handleTiendanubeLogin = async () => {
        setLoading(true);
        try {
            const response = await fetch(`${BACKEND_URL}/tiendanube/auth`);
            const data = await response.json();

            if (data.redirect) {
                window.location.href = data.redirect;
            } else {
                console.error('No se recibió URL de redirección de Tiendanube');
            }
        } catch (error) {
            console.error('Error iniciando auth con Tiendanube:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={wrapperClassName}>
            <button
                onClick={handleTiendanubeLogin}
                disabled={loading}
                className={className || styles.meliConnectBtn} // Reusar estilo de botón MELI por ahora
                style={{ background: 'linear-gradient(135deg, #2D325E, #4A5294)', color: 'white' }} // Estilo distintivo azul Tiendanube
            >
                {loading ? 'Conectando...' : 'Conectar Tiendanube'}
            </button>
        </div>
    );
};

export default TiendanubeAuthButton;
