export interface ClienteNuevoDTO {
  nombre_razon_social: string;
  tipo_cliente: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  id_municipio?: number;
  notas_internas?: string;
}

export interface DetalleOrdenDTO {
  id_producto: number;
  id_producto_reacondicionado?: number;
  cantidad: number;
}

export interface CrearVentaDTO {
  id_sucursal: number;
  id_vendedor: number;
  nit: string;
  cliente_nuevo?: ClienteNuevoDTO | null;
  canal: "mostrador" | "domicilio";
  pago_contra_entrega?: boolean;
  id_repartidor?: number | null;
  direccion_entrega?: string | null;
  nombre_contacto?: string | null;
  telefono_contacto?: string | null;
  id_municipio_entrega?: number | null;
  descuento_porcentaje?: number;
  detalles: DetalleOrdenDTO[];
}
