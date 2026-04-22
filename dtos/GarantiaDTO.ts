// dtos/GarantiaDTO.ts

export interface CrearGarantiaDTO {
  id_detalle_venta: number;
  cantidad: number;
  motivo_reclamo: string;
}

export interface ResolverGarantiaDTO {
  id_garantia: number;
  id_supervisor: number;
  aprobado: boolean;
  resolucion: string;
  // Al aprobar: condicion_recibido es obligatorio (validado en el schema Zod).
  // Al rechazar: condicion_recibido es opcional — solo se envía si el cliente
  //              entregó físicamente la pieza a pesar del rechazo.
  condicion_recibido?: string;
  notas_inspeccion?: string;
}
