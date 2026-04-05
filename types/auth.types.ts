// types/auth.types.ts
export enum RolSistema {
  ADMINISTRADOR = "ADMINISTRADOR",
  GERENTE_REGIONAL = "GERENTE_REGIONAL",
  SUPERVISOR_SUCURSAL = "SUPERVISOR_SUCURSAL",
  VENDEDOR = "VENDEDOR",
  CAJERO = "CAJERO",
  BODEGUERO = "BODEGUERO",
  REPARTIDOR = "REPARTIDOR",
}

export interface PayloadToken {
  id_usuario: number;
  id_empleado: number;
  id_sucursal: number;
  rol: RolSistema;
}
