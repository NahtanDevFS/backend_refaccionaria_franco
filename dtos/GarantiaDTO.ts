export interface CrearGarantiaDTO {
  id_detalle_venta: number;
  cantidad: number;
  motivo_reclamo: string;
}

export interface ResolverGarantiaDTO {
  id_garantia: number;
  id_supervisor: number;
  aprobado: boolean; //true para aprobada, false para no aprobada
  resolucion: string;
}
