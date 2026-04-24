// services/ArqueoService.ts
import { Pool } from "pg";
import { ArqueoDTO } from "../dtos/ArqueoDTO";
import { EstadoArqueo } from "../types/arqueo.types";

const ROLES_SUPERVISOR = [
  "ADMINISTRADOR",
  "GERENTE_REGIONAL",
  "SUPERVISOR_SUCURSAL",
];

export class ArqueoService {
  constructor(private readonly pool: Pool) {}

  // ── Cierre de caja ────────────────────────────────────────────────────────
  async procesarCierreDeCaja(
    dto: ArqueoDTO & {
      id_cajero: number;
      id_sucursal: number;
    },
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Efectivo del sistema: cobros en efectivo no arquiados de hoy
      //    metodo_pago → JOIN metodo_cobro para filtrar por nombre
      const resResumen = await client.query(
        `SELECT COALESCE(SUM(c.monto), 0) AS total
         FROM cobro c
         JOIN metodo_cobro mc ON c.id_metodo_cobro = mc.id_metodo_cobro
         WHERE c.id_cajero        = $1
           AND DATE(c.fecha_cobro) = CURRENT_DATE
           AND mc.nombre           = 'efectivo'
           AND c.id_arqueo        IS NULL
           AND c.activo            = true`,
        [dto.id_cajero],
      );
      const efectivoSistema = Number(resResumen.rows[0].total);

      // 2. Diferencia y nombre del estado
      const diferencia = dto.efectivo_contado - efectivoSistema;
      const estadoNombre =
        diferencia === 0 ? EstadoArqueo.CUADRADO : EstadoArqueo.CON_DIFERENCIA;

      // 3. Insertar arqueo
      //    id_estado_arqueo via subquery — ya no es un VARCHAR
      const result = await client.query(
        `INSERT INTO arqueo_caja
           (id_sucursal, id_cajero, id_supervisor_verifica,
            efectivo_contado, efectivo_segun_sistema, diferencia,
            observaciones, id_estado_arqueo)
         VALUES (
           $1, $2, NULL, $3, $4, $5, $6,
           (SELECT id_estado_arqueo FROM estado_arqueo WHERE nombre = $7)
         )
         RETURNING *`,
        [
          dto.id_sucursal,
          dto.id_cajero,
          dto.efectivo_contado,
          efectivoSistema,
          diferencia,
          dto.observaciones || null,
          estadoNombre,
        ],
      );
      const arqueoRegistrado = result.rows[0];

      // 4. Asociar cobros del día al arqueo
      await client.query(
        `UPDATE cobro
         SET id_arqueo = $1
         WHERE id_cajero        = $2
           AND DATE(fecha_cobro) = CURRENT_DATE
           AND id_arqueo        IS NULL
           AND activo            = true`,
        [arqueoRegistrado.id_arqueo, dto.id_cajero],
      );

      await client.query("COMMIT");

      return {
        exito: true,
        mensaje:
          estadoNombre === EstadoArqueo.CUADRADO
            ? "Arqueo cuadrado perfectamente."
            : `Arqueo con diferencia de Q${Math.abs(diferencia).toFixed(2)}. Pendiente de verificación por supervisor.`,
        data: arqueoRegistrado,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // ── Verificar arqueo con diferencia (solo supervisor/admin) ───────────────
  async verificarArqueo(
    id_arqueo: number,
    id_supervisor: number,
    id_sucursal: number,
  ) {
    const check = await this.pool.query(
      `SELECT ac.id_arqueo, ea.nombre AS estado, ac.id_supervisor_verifica
       FROM arqueo_caja ac
       JOIN estado_arqueo ea ON ac.id_estado_arqueo = ea.id_estado_arqueo
       WHERE ac.id_arqueo = $1 AND ac.id_sucursal = $2`,
      [id_arqueo, id_sucursal],
    );

    if (check.rows.length === 0)
      throw new Error("Arqueo no encontrado o de otra sucursal.");

    const arqueo = check.rows[0];

    if (arqueo.estado !== EstadoArqueo.CON_DIFERENCIA)
      throw new Error("Solo se pueden verificar arqueos con diferencia.");

    if (arqueo.id_supervisor_verifica)
      throw new Error("Este arqueo ya fue verificado.");

    await this.pool.query(
      `UPDATE arqueo_caja
       SET id_supervisor_verifica = $1, updated_at = NOW()
       WHERE id_arqueo = $2`,
      [id_supervisor, id_arqueo],
    );

    return { id_arqueo, verificado_por: id_supervisor };
  }

  // ── Historial de arqueos ──────────────────────────────────────────────────
  async obtenerHistorialArqueos(params: {
    id_sucursal: number;
    rol: string;
    id_cajero_usuario: number;
    desde: string;
    hasta: string;
    id_cajero_filtro?: number;
  }) {
    const {
      id_sucursal,
      rol,
      id_cajero_usuario,
      desde,
      hasta,
      id_cajero_filtro,
    } = params;

    const esSupervisor = ROLES_SUPERVISOR.includes(rol);
    const values: any[] = [id_sucursal, desde, hasta];
    let filtroCajero = "";

    if (!esSupervisor) {
      values.push(id_cajero_usuario);
      filtroCajero = `AND ac.id_cajero = $${values.length}`;
    } else if (id_cajero_filtro) {
      values.push(id_cajero_filtro);
      filtroCajero = `AND ac.id_cajero = $${values.length}`;
    }

    const result = await this.pool.query(
      `SELECT
         ac.id_arqueo,
         ac.fecha_cierre,
         ac.created_at,
         ac.efectivo_contado,
         ac.efectivo_segun_sistema,
         ac.diferencia,
         ea.nombre                                             AS estado,
         ac.observaciones,
         ac.id_cajero,
         ac.id_supervisor_verifica,
         CONCAT(ec.nombre, ' ', ec.apellido)                   AS cajero,
         CASE
           WHEN es.id_empleado IS NOT NULL
           THEN CONCAT(es.nombre, ' ', es.apellido)
           ELSE NULL
         END                                                   AS supervisor_verifica
       FROM arqueo_caja ac
       JOIN estado_arqueo ea ON ac.id_estado_arqueo        = ea.id_estado_arqueo
       INNER JOIN empleado ec ON ac.id_cajero              = ec.id_empleado
       LEFT  JOIN empleado es ON ac.id_supervisor_verifica = es.id_empleado
       WHERE ac.id_sucursal = $1
         AND ac.fecha_cierre BETWEEN $2 AND $3
         ${filtroCajero}
       ORDER BY ac.created_at DESC`,
      values,
    );

    const filas = result.rows.map((r) => ({
      id_arqueo: r.id_arqueo,
      fecha_cierre: r.fecha_cierre,
      created_at: r.created_at,
      efectivo_contado: Number(r.efectivo_contado),
      efectivo_segun_sistema: Number(r.efectivo_segun_sistema),
      diferencia: Number(r.diferencia),
      estado: r.estado as "cuadrado" | "con_diferencia",
      observaciones: r.observaciones ?? null,
      cajero: r.cajero,
      id_cajero: r.id_cajero,
      supervisor_verifica: r.supervisor_verifica ?? null,
      pendiente_verificacion:
        r.estado === EstadoArqueo.CON_DIFERENCIA && !r.id_supervisor_verifica,
    }));

    const totalArqueos = filas.length;
    const cuadrados = filas.filter((f) => f.estado === "cuadrado").length;
    const conDiferencia = filas.filter(
      (f) => f.estado === "con_diferencia",
    ).length;
    const sinVerificar = filas.filter((f) => f.pendiente_verificacion).length;
    const sumaDiferencias = filas.reduce((acc, f) => acc + f.diferencia, 0);

    return {
      resumen: {
        totalArqueos,
        cuadrados,
        conDiferencia,
        sinVerificar,
        sumaDiferencias,
      },
      arqueos: filas,
    };
  }

  // ── Cajeros de la sucursal ────────────────────────────────────────────────
  // Antes filtraba por puesto.nombre ILIKE '%cajero%'
  // Ahora filtra por rol.nombre = 'CAJERO'
  async obtenerCajerosDeSucursal(id_sucursal: number) {
    const result = await this.pool.query(
      `SELECT e.id_empleado, CONCAT(e.nombre, ' ', e.apellido) AS nombre
       FROM empleado e
       INNER JOIN usuario u ON u.id_empleado = e.id_empleado
       INNER JOIN rol     r ON u.id_rol      = r.id_rol
       WHERE e.id_sucursal = $1
         AND r.nombre      = 'CAJERO'
         AND e.activo      = true
       ORDER BY e.nombre`,
      [id_sucursal],
    );
    return result.rows;
  }
}
