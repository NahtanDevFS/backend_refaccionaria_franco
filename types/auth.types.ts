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
  //null para GERENTE_REGIONAL, que se vincula a una región, no a una sucursal
  id_sucursal: number | null;
  //solo presente para GERENTE_REGIONAL; null para todos los demás roles
  id_region: number | null;
  rol: RolSistema;
}
