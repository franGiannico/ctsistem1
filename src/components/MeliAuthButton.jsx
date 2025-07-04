// file: src/components/MeliAuthButton.jsx

// import React, { useState } from 'react';

// const MeliAuthButton = () => {
//   const [cargando, setCargando] = useState(false);
//   const [error, setError] = useState(null);

//   const iniciarAutenticacion = async () => {
//     setCargando(true);
//     setError(null);

//     try {
//       const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/meli/auth`);
//       const data = await res.json();

//       if (data.autenticado) {
//         alert('Ya estás autenticado con Mercado Libre.');
//       } else if (data.redirect) {
//         window.location.href = data.redirect; // Redirecciona a la URL de autenticación de Mercado Libre
//       } else {
//         throw new Error('Respuesta inesperada del servidor');
//       }
//     } catch (err) {
//       console.error('Error al iniciar autenticación:', err);
//       setError('Hubo un problema al conectar con Mercado Libre.');
//     } finally {
//       setCargando(false);
//     }
//   };

//   return (
//     <div>
//       <button onClick={iniciarAutenticacion} disabled={cargando} className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 px-4 rounded">
//         {cargando ? 'Conectando...' : 'Conectar con Mercado Libre'}
//       </button>
//       {error && <p className="text-red-600 mt-2">{error}</p>}
//     </div>
//   );
// };

// export default MeliAuthButton;
