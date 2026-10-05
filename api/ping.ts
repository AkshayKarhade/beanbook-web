export default {
  fetch() {
    return Response.json({
      ok: true,
      message: "BeanBook API is alive",
    });
  },
};