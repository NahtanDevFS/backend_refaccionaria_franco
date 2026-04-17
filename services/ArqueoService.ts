// services/ArqueoService.ts
import { Pool } from "pg";
import { ArqueoDTO } from "../dtos/ArqueoDTO";
import { EstadoArqueo } from "../types/arqueo.types";

const ROLES_GLOBALES = ["ADMINISTRADOR", "GERENTE_REGIONAL"];

export class ArqueoService {
  constructor(private readonly pool: Pool) {}

  async procesarCierreDeCaja(
    dto: ArqueoDTO & {
      id_cajero: number;
      id_sucursal: number;
      id_supervisor_verifica?: number;
    },
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Efectivo del sistema (solo efectivo no arquiado del día)
      const resResumen = await client.query(
        `SELECT COALESCE(SUM(monto), 0) as total FROM pago
         WHERE id_cajero = $1
           AND DATE(fecha_pago) = CURRENT_DATE
           AND metodo_pago = 'efectivo'
           AND id_arqueo IS NULL`,
        [dto.id_cajero],
      );
      const efectivoSistema = Number(resResumen.rows[0].total);

      // 2. Diferencia y estado
      const diferencia = dto.efectivo_contado - efectivoSistema;
      const estado =
        diferencia === 0 ? EstadoArqueo.CUADRADO : EstadoArqueo.CON_DIFERENCIA;

      // 3. Insertar arqueo
      const result = await client.query(
        `INSERT INTO arqueo_caja
           (id_sucursal, id_cajero, id_supervisor_verifica,
            efectivo_contado, efectivo_segun_sistema, diferencia,
            observaciones, estado)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          dto.id_sucursal,
          dto.id_cajero,
          dto.id_supervisor_verifica || null,
          dto.efectivo_contado,
          efectivoSistema,
          diferencia,
          dto.observaciones || null,
          estado,
        ],
      );
      const arqueoRegistrado = result.rows[0];

      // 4. Asociar pagos del día al arqueo
      await client.query(
        `UPDATE pago SET id_arqueo = $1
         WHERE id_cajero = $2
           AND DATE(fecha_pago) = CURRENT_DATE
           AND id_arqueo IS NULL`,
        [arqueoRegistrado.id_arqueo, dto.id_cajero],
      );

      await client.query("COMMIT");

      return {
        exito: true,
        mensaje:
          estado === EstadoArqueo.CUADRADO
            ? "Arqueo cuadrado perfectamente."
            : `Arqueo con diferencia detectada de Q${Math.abs(diferencia).toFixed(2)}.`,
        data: arqueoRegistrado,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // ─── NUEVO: Historial de arqueos ──────────────────────────────────────────
  async obtenerHistorialArqueos(params: {
    id_sucursal: number;
    rol: string;
    id_cajero_usuario: number; // el cajero que hace la consulta
    desde: string;
    hasta: string;
    id_cajero_filtro?: number; // filtro opcional por cajero específico
  }) {
    const {
      id_sucursal,
      rol,
      id_cajero_usuario,
      desde,
      hasta,
      id_cajero_filtro,
    } = params;

    const esGlobal = ROLES_GLOBALES.includes(rol);
    const esSupervisor = rol === "SUPERVISOR_SUCURSAL" || esGlobal;

    const values: any[] = [id_sucursal, desde, hasta];
    let filtroCajero = "";

    if (!esSupervisor) {
      // Cajero: solo ve sus propios arqueos
      values.push(id_cajero_usuario);
      filtroCajero = `AND ac.id_cajero = $${values.length}`;
    } else if (id_cajero_filtro) {
      // Supervisor/Admin con filtro por cajero específico
      values.push(id_cajero_filtro);
      filtroCajero = `AND ac.id_cajero = $${values.length}`;
    }

    const query = `
      SELECT
        ac.id_arqueo,
        ac.fecha_cierre,
        ac.created_at,
        ac.efectivo_contado,
        ac.efectivo_segun_sistema,
        ac.diferencia,
        ac.estado,
        ac.observaciones,
        CONCAT(ec.nombre, ' ', ec.apellido)  AS cajero,
        ac.id_cajero,
        CONCAT(es.nombre, ' ', es.apellido)  AS supervisor_verifica
      FROM arqueo_caja ac
      INNER JOIN empleado ec ON ac.id_cajero              = ec.id_empleado
      LEFT  JOIN empleado es ON ac.id_supervisor_verifica = es.id_empleado
      WHERE ac.id_sucursal = $1
        AND ac.fecha_cierre BETWEEN $2 AND $3
        ${filtroCajero}
      ORDER BY ac.created_at DESC;
    `;

    const result = await this.pool.query(query, values);

    const filas = result.rows.map((r) => ({
      id_arqueo: r.id_arqueo,
      fecha_cierre: r.fecha_cierre,
      created_at: r.created_at,
      efectivo_contado: Number(r.efectivo_contado),
      efectivo_segun_sistema: Number(r.efectivo_segun_sistema),
      diferencia: Number(r.diferencia),
      estado: r.estado,
      observaciones: r.observaciones ?? null,
      cajero: r.cajero,
      id_cajero: r.id_cajero,
      supervisor_verifica: r.supervisor_verifica ?? null,
    }));

    // Resumen del período
    const totalArqueos = filas.length;
    const cuadrados = filas.filter((f) => f.estado === "cuadra").length;
    const conDiferencia = filas.filter(
      (f) => f.estado === "con_diferencia",
    ).length;
    const sumaDiferencias = filas.reduce((acc, f) => acc + f.diferencia, 0);

    return {
      resumen: { totalArqueos, cuadrados, conDiferencia, sumaDiferencias },
      arqueos: filas,
    };
  }

  // ─── Listado de cajeros de la sucursal (para el filtro del supervisor) ───
  async obtenerCajerosDeSucursal(id_sucursal: number) {
    const result = await this.pool.query(
      `SELECT e.id_empleado, CONCAT(e.nombre, ' ', e.apellido) AS nombre
       FROM empleado e
       INNER JOIN puesto p ON e.id_puesto = p.id_puesto
       WHERE e.id_sucursal = $1
         AND p.nombre ILIKE '%cajero%'
         AND e.activo = true
       ORDER BY e.nombre`,
      [id_sucursal],
    );
    return result.rows;
  }
}
