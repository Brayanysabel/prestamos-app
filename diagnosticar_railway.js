// diagnosticar_railway.js - Prueba de conectividad a Railway PostgreSQL
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || process.argv[2];

if (!DATABASE_URL) {
  console.error('❌ Falta DATABASE_URL.Úsalo como:');
  console.error('   node diagnosticar_railway.js "postgresql://user:pass@host:5432/db"');
  process.exit(1);
}

console.log('🔍 Diagnosticando conexión a Railway PostgreSQL...\n');

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 5
});

async function diagnosticar() {
  const resultados = {
    conexionInicial: false,
    consultaSimple: false,
    poolStats: null,
    stressTest: false,
    reconexion: false,
    error: null
  };

  try {
    // 1. Conexión inicial
    console.log('1️⃣  Probando conexión inicial...');
    const client = await pool.connect();
    console.log('   ✅ Conexión establecida');
    resultados.conexionInicial = true;
    client.release();

    // 2. Consulta simple
    console.log('\n2️⃣  Ejecutando consulta simple (SELECT 1)...');
    const res = await pool.query('SELECT 1 as test, NOW() as timestamp');
    console.log(`   ✅ Consulta exitosa: ${JSON.stringify(res.rows[0])}`);
    resultados.consultaSimple = true;

    // 3. Estadísticas del pool
    console.log('\n3️⃣  Estadísticas del pool...');
    const stats = {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount
    };
    console.log(`   📊 Total: ${stats.total}, Idle: ${stats.idle}, Waiting: ${stats.waiting}`);
    resultados.poolStats = stats;

    // 4. Stress test - múltiples conexiones concurrentes
    console.log('\n4️⃣  Ejecutando stress test (10 consultas concurrentes)...');
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        pool.query('SELECT $1::text as iteracion', [`test-${i}`])
          .then(r => ({ success: true, iteracion: i, resultado: r.rows[0] }))
          .catch(e => ({ success: false, iteracion: i, error: e.message }))
      );
    }
    const stressResults = await Promise.all(promises);
    const exitosos = stressResults.filter(r => r.success).length;
    console.log(`   📈 Exitosas: ${exitosos}/10`);
    if (exitosos === 10) {
      console.log('   ✅ Stress test pasado');
      resultados.stressTest = true;
    } else {
      console.log('   ⚠️  Algunas consultas fallaron en el stress test');
      stressResults.filter(r => !r.success).forEach(r => {
        console.log(`      ❌ Iteración ${r.iteracion}: ${r.error}`);
      });
    }

    // 5. Prueba de reconexión después de cerrar una conexión
    console.log('\n5️⃣  Probando reconexión tras cierre forzado...');
    const testClient = await pool.connect();
    testClient.release();
    
    // Esperar un momento
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const res2 = await pool.query('SELECT 2 as test');
    console.log(`   ✅ Reconexión exitosa: ${JSON.stringify(res2.rows[0])}`);
    resultados.reconexion = true;

  } catch (err) {
    console.error('\n❌ Error durante el diagnóstico:', err.message);
    resultados.error = err.message;
    
    if (err.message.includes('timeout')) {
      console.error('   💡 Posible causa: Timeout de conexión. Railway puede estar sobrecargado.');
    } else if (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED')) {
      console.error('   💡 Posible causa: No se puede alcanzar el host. Verifica la URL.');
    } else if (err.message.includes('SSL')) {
      console.error('   💡 Posible causa: Problema con SSL. Asegúrate de usar rejectUnauthorized: false');
    } else if (err.message.includes('password') || err.message.includes('authentication')) {
      console.error('   💡 Posible causa: Credenciales incorrectas.');
    }
  } finally {
    await pool.end();
    
    console.log('\n' + '='.repeat(60));
    console.log('📋 RESUMEN DEL DIAGNÓSTICO');
    console.log('='.repeat(60));
    
    const Tests = [
      { nombre: 'Conexión inicial', ok: resultados.conexionInicial },
      { nombre: 'Consulta simple', ok: resultados.consultaSimple },
      { nombre: 'Pool stats', ok: !!resultados.poolStats },
      { nombre: 'Stress test', ok: resultados.stressTest },
      { nombre: 'Reconexión', ok: resultados.reconexion }
    ];
    
    Tests.forEach(t => {
      const icono = t.ok ? '✅' : '❌';
      console.log(`${icono} ${t.nombre}`);
    });
    
    if (resultados.error) {
      console.log(`\n❌ Error capturado: ${resultados.error}`);
    }
    
    const todasOk = Tests.every(t => t.ok);
    if (todasOk) {
      console.log('\n✅ Conexión a Railway funcionando correctamente.');
      console.log('💡 Si se cae en producción, revisa:');
      console.log('   - Railway free tier puede dormir la DB tras inactividad');
      console.log('   - Límite de conexiones simultáneas en el plan');
      console.log('   - Configura keep-alive en el pool del servidor');
    } else {
      console.log('\n⚠️  Hay problemas de conectividad. Revisa los errores arriba.');
    }
  }
}

diagnosticar();
