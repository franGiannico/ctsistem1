module.exports = [
  { minimo: 1_000_000, cuotas: 18, financiacion: 0.261 }, // Desde $1.000.000
  { minimo:   600_000, cuotas: 12, financiacion: 0.195 }, // $600.000 - $999.999
  { minimo:   400_000, cuotas: 9,  financiacion: 0.153 }, // $400.000 - $599.999
  { minimo:   250_000, cuotas: 6,  financiacion: 0.103 }, // $250.000 - $399.999
  { minimo:   100_000, cuotas: 3,  financiacion: 0.062 }, // $100.000 - $249.999
  { minimo:    50_000, cuotas: 2,  financiacion: 0.044 }, // $50.000 - $99.999
  { minimo:         0, cuotas: 0,  financiacion: 0.000 }, // Sin cuotas
];