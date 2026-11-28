package io.github.siren.viewer;

import android.os.Parcel;
import android.os.Parcelable;

/** 目录项读数：名字 + 大小 + 是否文件（清单计算的三态推导数据源）。 */
public class BridgeEntry implements Parcelable {
    public final String name;
    public final long size;
    public final boolean isFile;

    public BridgeEntry(String name, long size, boolean isFile) {
        this.name = name;
        this.size = size;
        this.isFile = isFile;
    }

    protected BridgeEntry(Parcel in) {
        name = in.readString();
        size = in.readLong();
        isFile = in.readByte() != 0;
    }

    public static final Creator<BridgeEntry> CREATOR =
        new Creator<BridgeEntry>() {
            @Override
            public BridgeEntry createFromParcel(Parcel in) {
                return new BridgeEntry(in);
            }

            @Override
            public BridgeEntry[] newArray(int size) {
                return new BridgeEntry[size];
            }
        };

    @Override
    public void writeToParcel(Parcel dest, int flags) {
        dest.writeString(name);
        dest.writeLong(size);
        dest.writeByte((byte) (isFile ? 1 : 0));
    }

    @Override
    public int describeContents() {
        return 0;
    }
}
