import app from '.'

describe('Test the application', () => {
  it('Should return 404 response', async () => {
    const res = await app.request('http://localhost/')
    expect(res.status).toBe(404)
  })
})
