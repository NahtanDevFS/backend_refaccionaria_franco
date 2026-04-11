import { IVentaRepository } from "../repositories/IVentaRepository";
import { IProductoRepository } from "../repositories/IProductoRepository";
import { CrearVentaDTO } from "../dtos/CrearVentaDTO";

export class VentaService {
  constructor(
    private readonly ventaRepository: IVentaRepository,
    private readonly productoRepository: IProductoRepository,
  ) {}

  async obtenerVentas(filtros?: any) {
    // El repositorio ahora devuelve { data: any[], total: number }
    return await this.ventaRepository.obtenerHistorialVentas(filtros);
  }

  async obtenerVendedores(id_sucursal: number) {
    return await this.ventaRepository.obtenerVendedoresPorSucursal(id_sucursal);
  }

  async crearOrdenVenta(data: CrearVentaDTO) {
    // La transacción SQL en el Repositorio ya se encarga de evitar
    // ventas sin stock y crear clientes si no existen.
    return await this.ventaRepository.crearOrdenVenta(data);
  }

  async obtenerRepartidores(id_sucursal: number) {
    return await this.ventaRepository.obtenerRepartidoresPorSucursal(
      id_sucursal,
    );
  }

  async obtenerPendientesAutorizacion(id_sucursal: number) {
    return await this.ventaRepository.obtenerPendientesAutorizacion(
      id_sucursal,
    );
  }

  async resolverAutorizacion(
    id_venta: number,
    id_supervisor: number,
    id_usuario_log: number,
    aprobado: boolean,
  ) {
    return await this.ventaRepository.resolverAutorizacion(
      id_venta,
      id_supervisor,
      id_usuario_log,
      aprobado,
    );
  }

  async obtenerVentaPorId(id_venta: number) {
    return await this.ventaRepository.obtenerVentaPorId(id_venta);
  }
}
