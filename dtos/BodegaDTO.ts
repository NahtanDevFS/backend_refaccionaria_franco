// dtos/BodegaDTO.ts
export interface DetalleDespachoDTO {
  id_producto: number;
  cantidad: number;
}

export interface EmitirDespachoDTO {
  id_sucursal_destino: number;
  detalles: DetalleDespachoDTO[];
}

export interface AjusteInventarioDTO {
  id_producto: number;
  tipo: "ajuste_positivo" | "ajuste_negativo";
  cantidad: number;
  motivo: string;
}
