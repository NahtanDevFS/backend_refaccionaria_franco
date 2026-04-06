export interface ClienteNuevoDTO {
  nombre_razon_social: string;
  tipo_cliente: string;
  telefono?: string;
  direccion?: string;
  id_municipio?: number;
}

export interface DetalleOrdenDTO {
  id_producto: number;
  cantidad: number;
}

export interface CrearVentaDTO {
  id_sucursal: number;
  id_vendedor: number;
  nit: string;
  cliente_nuevo?: ClienteNuevoDTO | null;
  canal: "mostrador" | "domicilio";
  id_repartidor?: number | null;
  direccion_entrega?: string | null;
  detalles: DetalleOrdenDTO[];
}
