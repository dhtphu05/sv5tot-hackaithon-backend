# Non-AI E2E Test Scenario

Muc tieu: test luong khong dung AI tu sinh vien tao ho so, luu ban nhap, nhap chi so, upload minh chung, nop ho so, can bo xet duyet, quan ly xem dashboard/thong ke, hoi dong chot ket qua.

## Chay test tu dong

Dieu kien:

- Backend da cai dependency.
- `DATABASE_URL` tro toi DB test co migration moi nhat.
- Storage local dung `UPLOAD_DIR=./uploads`.

Lenh:

```bash
npm run test -- tests/integration/non-ai-application-flow.test.ts
```

Test tu dong se tu seed cac tai khoan E2E:

- `e2e.student@dut.udn.vn`
- `e2e.officer.ethics@dut.udn.vn`
- `e2e.officer.academic@dut.udn.vn`
- `e2e.officer.physical@dut.udn.vn`
- `e2e.officer.volunteer@dut.udn.vn`
- `e2e.officer.integration@dut.udn.vn`
- `e2e.manager@dut.udn.vn`
- `e2e.committee@dut.udn.vn`

Mat khau chung: `Password@123`.

## Kich ban test thu cong tren UI

1. Dang nhap sinh vien `e2e.student@dut.udn.vn / Password@123`.
2. Vao ho so ca nhan, chon nam hoc `2098-2099`, tao ho so cap `school`.
3. Nhap thong tin co ban va bam/cho autosave. Tai trang ban nhap phai thay ban nhap duoc luu, reload khong mat du lieu.
4. Nhap cac chi so: GPA `3.6/4`, ren luyen `92`, the luc `8.5`, tinh nguyen `12` ngay, hoi nhap `7.5`.
5. Tao va upload file PDF cho 5 minh chung: `ethics`, `academic`, `physical`, `volunteer`, `integration`.
6. Mo danh sach minh chung, kiem tra moi minh chung co file va trang thai upload/indexing.
7. Nop ho so voi tuy chon chap nhan canh bao tien kiem neu UI hien warning.
8. Dang nhap tung can bo theo tieu chi, mo hang doi review, vao task duoc giao, xac nhan co minh chung dung tieu chi, quyet dinh `accepted`.
9. Dang nhap `e2e.manager@dut.udn.vn`, mo dashboard/danh sach ho so. Ho so phai nam trong nam `2098-2099`, co tien do review `5/5` va aggregation cho phep chot.
10. Dang nhap `e2e.committee@dut.udn.vn`, chot ho so `passed`, cap `school`, nhap ghi chu ket qua.
11. Dang nhap lai sinh vien, kiem tra thong bao ket qua va timeline ho so co cac moc: started, autosaved, evidence uploaded, submitted, review accepted, finalized.

Ket qua mong doi: ho so ket thuc o trang thai `completed`, `finalStatus=passed`, `finalLevel=school`; dashboard khong con task active cho ho so nay.
