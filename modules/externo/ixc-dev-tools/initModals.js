function initModals(a) {
  "grid" === a.data.modalData.modalType
    ? document.querySelector(
        ".ixc-grids.grid-global-container.flexigrid.novstripe"
      ) || cria_grid("#1_grid", a.data.modalData.modalName, "S")
    : "form" === a.data.modalData.modalType &&
      (document.querySelector('.modal2.ixc-modal[variant="form"]') ||
        (null === a.data.modalData.modalId
          ? IXC.modal(1).form(a.data.modalData.modalName).funcoes().novo()
          : IXC.modal(1)
              .form(a.data.modalData.modalName)
              .funcoes()
              .edita(a.data.modalData.modalId)));
}
window.addEventListener("message", function (a) {
  "initModals" === a.data.function && initModals(a);
});
